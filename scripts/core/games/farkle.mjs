/* «Кости» (Farkle, зонк).

   Шесть костей. Бросок — затем игрок откладывает хотя бы одну очковую комбинацию
   и либо бросает оставшиеся кости, либо записывает набранное за ход. Бросок без
   единой очковой кости — зонк: очки хода сгорают, ход переходит. Отложены все
   шесть — «горячие кости»: снова бросаются все шесть, очки хода сохраняются.
   Первая запись места должна быть не меньше порога входа. Кто первым набрал цель — победил.

   Комбинации: единица 100, пятёрка 50; три одинаковых — грань × 100 (три единицы — 1000),
   каждая следующая такая же кость удваивает; 1–6 — 1500 (всегда); по настройке
   straights: 1–5 — 500, 2–6 — 750; по настройке threePairs: три пары — 750.

   state = {
     order: seatId[],                    // места в порядке ходов (все играют)
     rules: { target, entry, threePairs, straights },
     scores: { [seatId]: number },
     entered: { [seatId]: boolean },     // сделана ли первая запись (порог входа)
     current: seatId | null,
     turn: {
       dice: number[],     // кости на сукне после последнего броска (пусто до первого броска хода)
       kept: number[],     // отложенные за ход, по порядку; на горячих костях сбрасывается
       points: number,     // очки, набранные за ход
       rolls: number,      // бросков за ход
     },
     winner: seatId | null,
     finished: boolean,
   }
   После победы turn остаётся таким, каким был в момент записи (для показа последнего лотка).

   Ходы: { type: "roll" }                                  — первый бросок хода
         { type: "keep", indices: number[], then: "roll" | "bank" }
            indices — номера в turn.dice; then — что делать после: бросать дальше или записать
   События: rolled {seat, values, hot} · kept {seat, values, score, points}
            farkle {seat, values, lost} · banked {seat, points, total}
            won {seat, total} · left {seat}
   Ошибки: finished · notYourTurn · badAction · mustRoll · mustKeep · badSelection · belowEntry
*/

import { clone, normalizeBySchema, nextInOrder, subsets } from "../util.mjs";

const OPTIONS = [
  { key: "target", type: "number", default: 2000, min: 1000, max: 10000, step: 500 },
  { key: "entry", type: "number", default: 350, min: 0, max: 1000, step: 50 },
  { key: "threePairs", type: "bool", default: false },
  { key: "straights", type: "bool", default: true },
];

const DEFAULT_RULES = normalizeBySchema(OPTIONS);

const DICE = 6;
const SINGLES = { 1: 100, 5: 50 };
const THREE_PAIRS = 750;
const STRAIGHTS = [
  { faces: [1, 2, 3, 4, 5, 6], score: 1500, always: true },
  { faces: [1, 2, 3, 4, 5], score: 500 },
  { faces: [2, 3, 4, 5, 6], score: 750 },
];

const kindScore = (face, n) => (face === 1 ? 1000 : face * 100) * 2 ** (n - 3);

const freshTurn = () => ({ dice: [], kept: [], points: 0, rolls: 0 });

/** Сколько каких граней; null — если среди значений не кости к6. */
function tally(values) {
  if (!Array.isArray(values)) return null;
  const c = new Array(DICE + 1).fill(0);
  for (const v of values) {
    if (!Number.isInteger(v) || v < 1 || v > DICE) return null;
    c[v]++;
  }
  return c;
}

const isThreePairs = (c, total) => total === DICE && c.filter((n) => n === 2).length === 3;

/** Лучший разбор набора на комбинации без остатка; -Infinity — разобрать нельзя. */
function bestSplit(c, rules) {
  const face = c.findIndex((n, i) => i > 0 && n > 0);
  if (face < 0) return 0;
  let best = -Infinity;
  const take = (faces, n, score) => {
    const rest = [...c];
    for (const f of faces) rest[f] -= n;
    best = Math.max(best, score + bestSplit(rest, rules));
  };
  // Младшая из оставшихся граней обязана куда-то войти: в стрит, в набор одинаковых или одиночкой.
  for (const s of STRAIGHTS) {
    if (!s.always && !rules.straights) continue;
    if (!s.faces.includes(face) || s.faces.some((f) => c[f] === 0)) continue;
    take(s.faces, 1, s.score);
  }
  for (let n = 3; n <= c[face]; n++) take([face], n, kindScore(face, n));
  if (SINGLES[face]) take([face], 1, SINGLES[face]);
  return best;
}

/** Очки отложенного набора; 0 — если хоть одна кость в нём не входит в комбинацию. */
export function scoreSelection(values, rules = DEFAULT_RULES) {
  const c = tally(values);
  if (!c || values.length === 0) return 0;
  let best = bestSplit(c, rules);
  if (rules.threePairs && isThreePairs(c, values.length)) best = Math.max(best, THREE_PAIRS);
  return best > 0 ? best : 0;
}

/** Есть ли в броске хоть что-то очковое (иначе — зонк). */
export function hasScore(values, rules = DEFAULT_RULES) {
  const c = tally(values);
  if (!c) return false;
  // Любой стрит содержит пятёрку, так что отдельно их проверять не нужно.
  if (c[1] > 0 || c[5] > 0 || c.some((n) => n >= 3)) return true;
  return Boolean(rules.threePairs) && isThreePairs(c, values.length);
}

/** Все очковые наборы броска: [{ indices, values, score }]. */
export function scoringSelections(dice, rules = DEFAULT_RULES) {
  const out = [];
  for (const indices of subsets(dice.length)) {
    const values = indices.map((i) => dice[i]);
    const score = scoreSelection(values, rules);
    if (score > 0) out.push({ indices, values, score });
  }
  return out;
}

/** Разбор indices хода: { values, score } или null, если набор негодный. */
function selection(state, indices) {
  const dice = state.turn.dice;
  if (!Array.isArray(indices) || indices.length === 0) return null;
  if (new Set(indices).size !== indices.length) return null;
  if (indices.some((i) => !Number.isInteger(i) || i < 0 || i >= dice.length)) return null;
  const values = indices.map((i) => dice[i]);
  const score = scoreSelection(values, state.rules);
  return score > 0 ? { values, score } : null;
}

const canBank = (state, seatId, points) => state.entered[seatId] || points >= state.rules.entry;

function passTurn(state, toSeat = nextInOrder(state.order, state.current)) {
  state.current = toSeat;
  state.turn = freshTurn();
}

function win(state, seatId, events) {
  state.winner = seatId;
  state.finished = true;
  state.current = null;
  events.push({ type: "won", seat: seatId, total: state.scores[seatId] ?? 0 });
}

/** Бросок count костей текущим местом; без очков — зонк и переход хода. */
async function rollDice(state, seatId, count, hot, ctx, events) {
  const [values] = await ctx.roll([{ sides: 6, count }], { seat: seatId, reason: "farkle" });
  const t = state.turn;
  t.dice = [...values];
  t.rolls += 1;
  events.push({ type: "rolled", seat: seatId, values: [...values], hot });
  if (hasScore(values, state.rules)) return;
  events.push({ type: "farkle", seat: seatId, values: [...values], lost: t.points });
  passTurn(state);
}

export default {
  id: "farkle",
  seats: { min: 2, max: 6 },
  hasSecrets: false,
  options: OPTIONS,

  normalizeOptions: (raw) => normalizeBySchema(OPTIONS, raw),

  async setup({ seatIds, options }) {
    return {
      order: [...seatIds],
      rules: normalizeBySchema(OPTIONS, options),
      scores: Object.fromEntries(seatIds.map((id) => [id, 0])),
      entered: Object.fromEntries(seatIds.map((id) => [id, false])),
      current: seatIds[0] ?? null,
      turn: freshTurn(),
      winner: null,
      finished: false,
    };
  },

  currentSeat: (state) => (state.finished ? null : state.current),

  legalActions(state, seatId) {
    if (state.finished || state.current !== seatId) return [];
    const t = state.turn;
    if (t.dice.length === 0) return [{ type: "roll" }];
    const out = [];
    for (const { indices, score } of scoringSelections(t.dice, state.rules)) {
      out.push({ type: "keep", indices, then: "roll" });
      if (canBank(state, seatId, t.points + score)) out.push({ type: "keep", indices, then: "bank" });
    }
    return out;
  },

  validate(state, seatId, action) {
    if (state.finished) return "finished";
    if (state.current !== seatId) return "notYourTurn";
    const t = state.turn;
    if (action?.type === "roll") return t.dice.length > 0 ? "mustKeep" : null;
    if (action?.type === "keep") {
      if (action.then !== "roll" && action.then !== "bank") return "badAction";
      if (t.dice.length === 0) return "mustRoll";
      const sel = selection(state, action.indices);
      if (!sel) return "badSelection";
      if (action.then === "bank" && !canBank(state, seatId, t.points + sel.score)) return "belowEntry";
      return null;
    }
    return "badAction";
  },

  async apply(input, seatId, action, ctx) {
    const state = clone(input);
    const events = [];
    const t = state.turn;

    if (action.type === "roll") {
      await rollDice(state, seatId, DICE, false, ctx, events);
    } else if (action.type === "keep") {
      const { values, score } = selection(state, action.indices);
      const picked = new Set(action.indices);
      t.points += score;
      t.kept.push(...values);
      t.dice = t.dice.filter((_, i) => !picked.has(i));
      events.push({ type: "kept", seat: seatId, values: [...values], score, points: t.points });

      if (action.then === "roll") {
        // Отложены все — горячие кости: лоток пустеет, снова бросаются все шесть.
        const hot = t.dice.length === 0;
        if (hot) t.kept = [];
        await rollDice(state, seatId, hot ? DICE : t.dice.length, hot, ctx, events);
      } else {
        state.scores[seatId] += t.points;
        state.entered[seatId] = true;
        events.push({ type: "banked", seat: seatId, points: t.points, total: state.scores[seatId] });
        if (state.scores[seatId] >= state.rules.target) win(state, seatId, events);
        else passTurn(state);
      }
    }
    return { state, events };
  },

  async removeSeat(input, seatId) {
    const state = clone(input);
    const events = [{ type: "left", seat: seatId }];
    if (state.finished || !state.order.includes(seatId)) return { state, events };
    const wasCurrent = state.current === seatId;
    const next = nextInOrder(state.order, seatId, (id) => id !== seatId);
    state.order = state.order.filter((id) => id !== seatId);
    delete state.scores[seatId];
    delete state.entered[seatId];

    if (state.order.length === 1) {
      win(state, state.order[0], events);
      return { state, events };
    }
    if (wasCurrent) passTurn(state, next);
    return { state, events };
  },

  publicView: (state) => state,
  privateView: () => null,

  result(state) {
    if (!state.finished) return null;
    return { winners: state.winner ? [state.winner] : [], scores: { ...state.scores } };
  },
};
