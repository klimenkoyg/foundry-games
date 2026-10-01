/* Бот «Покера на костях».
   Кости открыты, поэтому бот считает шансы честно: для каждого набора «что оставить»
   разыгрывает переброс много раз и смотрит, как часто бьёт лучшего из соперников.
   Соперник, который ещё не перебрасывал, в прикидке перебрасывает одиночные кости.
   В ставках сила руки — та же прикидка шанса на победу; порог повышения зависит от нрава. */

import { evaluateHand } from "../games/poker.mjs";
import { counts, subsets } from "../util.mjs";

const SAMPLES = 120;

const REROLLS = [[], ...subsets(5)];

// Сила каждого из 6^5 раскладов одним числом: ранг, затем грани для сравнения равных.
const SCORE = new Int32Array(7776);
for (let key = 0; key < SCORE.length; key++) {
  const values = [];
  for (let k = key, i = 0; i < 5; i++, k = Math.floor(k / 6)) values.push(1 + (k % 6));
  const { rank, tiebreak } = evaluateHand(values);
  let score = rank;
  for (let i = 0; i < 5; i++) score = score * 7 + (tiebreak[i] ?? 0);
  SCORE[key] = score;
}

const keyOf = (values) => values.reduce((key, v) => key * 6 + v - 1, 0);

/** Простой переброс: стрит не трогать, пары и старше оставить, одиночные перебросить. */
function simpleReroll(values) {
  const { name } = evaluateHand(values);
  if (name === "smallStraight" || name === "bigStraight") return [];
  const c = counts(values);
  return values.flatMap((v, i) => (c[v] < 2 ? [i] : []));
}

/** Замысел переброса: ключ оставленных костей и сколько костей бросить. */
function plan(values, indices) {
  const kept = values.filter((_, i) => !indices.includes(i)).sort((a, b) => a - b);
  return { kept: keyOf(kept), count: indices.length };
}

function rollScore({ kept, count }, rng) {
  let key = kept;
  for (let i = 0; i < count; i++) key = key * 6 + Math.floor(rng() * 6);
  return SCORE[key];
}

/** Лучшая рука соперников в каждой из пробных раздач. */
function rivalScores(view, seatId, rng) {
  const final = view.phase === "bet2";
  const plans = view.order
    .filter((id) => id !== seatId && !view.folded[id])
    .map((id) => plan(view.dice[id], final || view.rerolled[id] ? [] : simpleReroll(view.dice[id])));
  const out = new Int32Array(SAMPLES).fill(-1);
  for (let i = 0; i < SAMPLES; i++) {
    for (const p of plans) out[i] = Math.max(out[i], rollScore(p, rng));
  }
  return out;
}

/** Доля побед замысла (ничья — половина); крошечная добавка за саму руку разводит равные доли. */
function winRate(p, targets, rng) {
  let total = 0;
  for (let i = 0; i < targets.length; i++) {
    const score = rollScore(p, rng);
    total += (score > targets[i] ? 1 : score === targets[i] ? 0.5 : 0) + score * 1e-9;
  }
  return total / targets.length;
}

function chooseReroll(view, seatId, temperament, rng) {
  const mine = view.dice[seatId];
  if (rng() > temperament.skill) return simpleReroll(mine);
  const targets = rivalScores(view, seatId, rng);
  const seen = new Set();
  let best = [];
  let bestRate = -1;
  for (const indices of REROLLS) {
    const p = plan(mine, indices);
    // Одинаковые оставленные кости — один и тот же замысел.
    const id = `${p.count}:${p.kept}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const rate = winRate(p, targets, rng);
    if (rate > bestRate) {
      best = indices;
      bestRate = rate;
    }
  }
  return [...best];
}

/** Шанс взять раздачу: до переброса — с простым перебросом у всех, после — как есть. */
function strength(view, seatId, rng) {
  const mine = view.dice[seatId];
  const final = view.phase === "bet2" || view.rerolled[seatId];
  return winRate(plan(mine, final ? [] : simpleReroll(mine)), rivalScores(view, seatId, rng), rng);
}

export default function decide({ view, seatId, temperament, rng }) {
  if (view.phase === "reroll") return { type: "reroll", indices: chooseReroll(view, seatId, temperament, rng) };

  const { round, rules } = view;
  const owes = round.put[seatId] < round.highest;
  const canRaise = round.raises < rules.maxRaises;
  const power = strength(view, seatId, rng);

  // Осторожный повышает только с верной рукой, азартный — уже с неплохой.
  if (canRaise && power > Math.min(0.95, 0.7 / temperament.greed)) return { type: "bet" };
  // Порог ответа — 0.35 один на один; за полным столом шанс делится на всех, порог ниже.
  const live = view.order.filter((id) => !view.folded[id]).length;
  if (owes) return { type: power > 0.7 / live || rng() < temperament.bluff * 0.5 ? "call" : "fold" };
  if (canRaise && rng() < temperament.bluff * 0.3) return { type: "bet" };
  return { type: "check" };
}
