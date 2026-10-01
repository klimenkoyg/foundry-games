/* Бот «Костей» (Farkle).
   Откладывает набор с лучшей ценой: очки плюс цена костей, оставшихся для броска
   (лишнюю пятёрку чаще оставляет катиться); если очковые все кости — берёт все ради
   горячих костей. Записывает, когда очков хода хватает для порога по числу оставшихся
   костей и нраву; победную запись делает всегда. Неумелый ходит наугад. */

import { scoringSelections } from "../games/farkle.mjs";
import { pick } from "../util.mjs";

// С каким счётом хода разумный игрок перестаёт бросать n костей.
const BANK_AT = { 1: 300, 2: 300, 3: 400, 4: 1000, 5: 2000, 6: Infinity };
const DIE_VALUE = 60;
const HOT_BONUS = 500;
const CLOSE_RACE = 400;
const RACE_GREED = 1.4;

const worth = (sel, diceCount) => {
  const left = diceCount - sel.indices.length;
  return sel.score + DIE_VALUE * left + (left === 0 ? HOT_BONUS : 0);
};

export default function decide({ view, seatId, temperament, rng }) {
  const { turn, rules } = view;
  if (turn.dice.length === 0) return { type: "roll" };

  const options = scoringSelections(turn.dice, rules);
  if (options.length === 0) return { type: "roll" };

  const mayBank = (sel) => view.entered[seatId] || turn.points + sel.score >= rules.entry;
  const keep = (sel, then) => ({ type: "keep", indices: sel.indices, then });

  // Раз записываем — берём всё, что даёт больше очков.
  const richest = options.reduce((a, b) => (b.score > a.score ? b : a));
  if (mayBank(richest) && view.scores[seatId] + turn.points + richest.score >= rules.target) return keep(richest, "bank");

  if (rng() > temperament.skill) {
    const sel = pick(rng, options);
    return keep(sel, pick(rng, mayBank(sel) ? ["roll", "bank"] : ["roll"]));
  }

  const count = turn.dice.length;
  const best = options.reduce((a, b) => {
    const diff = worth(b, count) - worth(a, count);
    return diff > 0 || (diff === 0 && b.score > a.score) ? b : a;
  });

  // Соперник у самой цели — тянем дольше: осторожность уже не спасёт.
  const rivalClose = view.order.some((id) => id !== seatId && view.scores[id] >= rules.target - CLOSE_RACE);
  const greed = temperament.greed * (rivalClose ? RACE_GREED : 1);
  const left = count - best.indices.length || 6;
  const enough = turn.points + best.score >= BANK_AT[left] * greed;

  if (enough && mayBank(richest)) return keep(richest, "bank");
  return keep(best, "roll");
}
