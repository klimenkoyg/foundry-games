/* Бот «Кнаклбоунс».
   Для каждого свободного столбца считает, сколько очков прибавит себе и сколько
   выбьет у соперника (жадный нрав ценит выбивание выше), плюс задел на будущее:
   свободные места рядом со своими костями — шанс собрать пару или тройку,
   а мелочь не должна занимать место рядом с крупной парой.
   Равные варианты — наугад; с вероятностью (1 − skill) ставит куда попало. */

import { columnScore } from "../games/kb.mjs";
import { counts, pick } from "../util.mjs";

const COLS = [0, 1, 2];
const SLOTS = 3;
const EPS = 1e-9;

const freeSlots = (board) => board.reduce((n, column) => n + SLOTS - column.length, 0);

/** Задел столбца: на каждое свободное место — шанс 1/6 добавить к значению v,
    которого уже n штук, ещё одну кость (это +2·v·n сверх обычной постановки). */
function potential(column) {
  const pairing = counts(column).reduce((total, n, v) => total + 2 * v * n, 0);
  return ((SLOTS - column.length) * pairing) / 6;
}

export default function decide({ view, seatId, temperament, rng }) {
  const foe = view.order.find((id) => id !== seatId);
  const own = view.boards[seatId];
  const opp = view.boards[foe];
  const die = view.die;

  const cols = COLS.filter((c) => own[c].length < SLOTS);
  if (cols.length <= 1) return { type: "place", col: cols[0] ?? 0 };
  if (rng() > temperament.skill) return { type: "place", col: pick(rng, cols) };

  const knockWeight = 0.7 + 0.4 * temperament.greed;
  let best = [];
  let bestValue = -Infinity;
  for (const c of cols) {
    const after = [...own[c], die];
    const oppAfter = opp[c].filter((v) => v !== die);
    const knocked = opp[c].length - oppAfter.length;
    const ownGain = columnScore(after) - columnScore(own[c]);
    const oppLoss = columnScore(opp[c]) - columnScore(oppAfter);
    let value = ownGain + oppLoss * knockWeight;

    // Задел имеет смысл, только если до конца партии ещё будет свой ход.
    const turnsLeft = Math.min(freeSlots(own) - 1, freeSlots(opp) + knocked - 1);
    if (turnsLeft > 0) value += potential(after) - potential(own[c]);

    if (value > bestValue + EPS) {
      best = [c];
      bestValue = value;
    } else if (value > bestValue - EPS) {
      best.push(c);
    }
  }
  return { type: "place", col: pick(rng, best) };
}
