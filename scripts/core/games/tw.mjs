/* «Двадцать одно» на многогранниках.

   Шесть костей: к4, к6, к8, к10, к12, к20 — каждую можно взять один раз за круг.
   Бросок прибавляется к сумме; больше предела — перебор, рука сгорела. Остановиться
   можно в любой момент. Место играет всю руку подряд (несколько взятий), и только
   потом ход переходит дальше. Все шесть костей взяты без перебора — рука закрыта сама.

   Круг берёт лучшая сумма без перебора. При равенстве наверху (настройка fewerDice)
   выигрывает тот, кто взял меньше костей; костей поровну или перебор у всех — круг ничей. Кто первым набрал rules.wins кругов — забирает партию.
   Открывающий круг сдвигается: первый круг начинает order[0], второй — следующий и т. д.

   state = {
     order: seatId[],          // все места в порядке ходов
     rules: { limit, wins, fewerDice },   // предел суммы, число кругов до победы, разбор равенства
     wins: { [seatId]: number },
     round: number,            // с 1
     firstSeat: seatId,        // кто открыл этот круг
     current: seatId | null,
     hands: { [seatId]: Hand },
     lastRound: { winner: seatId | null, totals: { [seatId]: number }, busts: seatId[], round } | null,
     winner: seatId | null,
     finished: boolean,
   }
   Hand = { rolled: [{ sides, value }], total, stood, bust, done }

   Ходы: { type: "take", sides } · { type: "stand" }
   События: took {seat, sides, value, total, bust, done} · stood {seat, total}
            roundWon {seat | null, totals, busts, round} · won {seat} · left {seat}
   Ошибки: finished · notYourTurn · badAction · badDie · dieUsed
*/

import { clamp, clone, normalizeBySchema, nextInOrder } from "../util.mjs";

export const DICE = [4, 6, 8, 10, 12, 20];

const OPTIONS = [
  { key: "limit", type: "number", default: 21, min: 15, max: 31, step: 1 },
  { key: "wins", type: "number", default: 3, min: 1, max: 5, step: 1 },
  // При равной сумме круг берёт тот, кто взял меньше костей (иначе ничьих слишком много).
  { key: "fewerDice", type: "bool", default: true },
];

/** Доля граней кости, с которыми сумма уйдёт за предел: 0 — безопасно, 1 — верный перебор. */
export function bustChance(total, sides, limit) {
  return clamp(total + sides - limit, 0, sides) / sides;
}

const emptyHand = () => ({ rolled: [], total: 0, stood: false, bust: false, done: false });

const isUsed = (hand, sides) => hand.rolled.some((r) => r.sides === sides);

function startRound(state, firstSeat) {
  state.round += 1;
  state.firstSeat = firstSeat;
  for (const id of state.order) state.hands[id] = emptyHand();
  state.current = firstSeat;
}

/** Первое по кругу от открывшего место, чья рука ещё не закрыта. */
function nextToPlay(state) {
  const n = state.order.length;
  const start = Math.max(0, state.order.indexOf(state.firstSeat));
  for (let k = 0; k < n; k++) {
    const id = state.order[(start + k) % n];
    if (!state.hands[id].done) return id;
  }
  return null;
}

function finishMatch(state, seatId, events) {
  state.winner = seatId;
  state.finished = true;
  state.current = null;
  events.push({ type: "won", seat: seatId });
}

/** Итог круга: лучшая сумма без перебора берёт круг. Равенство — по настройке fewerDice
    выигрывает взявший меньше костей; если и костей поровну (или настройка выключена) — круг ничей. */
function resolveRound(state, events) {
  const totals = Object.fromEntries(state.order.map((id) => [id, state.hands[id].total]));
  const busts = state.order.filter((id) => state.hands[id].bust);
  const alive = state.order.filter((id) => !state.hands[id].bust);
  const best = Math.max(-1, ...alive.map((id) => totals[id]));
  let top = alive.filter((id) => totals[id] === best);
  let byDice = false;
  if (top.length > 1 && state.rules.fewerDice) {
    const used = (id) => state.hands[id].rolled.length;
    const fewest = Math.min(...top.map(used));
    const leaner = top.filter((id) => used(id) === fewest);
    if (leaner.length === 1) {
      top = leaner;
      byDice = true;
    }
  }
  const winner = top.length === 1 ? top[0] : null;

  state.lastRound = { winner, totals, busts, round: state.round, byDice };
  events.push({ type: "roundWon", seat: winner, totals: { ...totals }, busts: [...busts], round: state.round, byDice });

  if (winner) {
    state.wins[winner] += 1;
    if (state.wins[winner] >= state.rules.wins) {
      finishMatch(state, winner, events);
      return;
    }
  }
  startRound(state, nextInOrder(state.order, state.firstSeat) ?? state.order[0]);
}

/** Ход переходит к следующей незакрытой руке; если закрыты все — итог круга. */
function advance(state, events) {
  const next = nextToPlay(state);
  if (next) state.current = next;
  else resolveRound(state, events);
}

export default {
  id: "tw",
  seats: { min: 2, max: 6 },
  hasSecrets: false,
  options: OPTIONS,

  normalizeOptions: (raw) => normalizeBySchema(OPTIONS, raw),

  async setup({ seatIds, options }) {
    const state = {
      order: [...seatIds],
      rules: { limit: options?.limit ?? 21, wins: options?.wins ?? 3, fewerDice: options?.fewerDice ?? true },
      wins: Object.fromEntries(seatIds.map((id) => [id, 0])),
      round: 0,
      firstSeat: null,
      current: null,
      hands: {},
      lastRound: null,
      winner: null,
      finished: false,
    };
    startRound(state, seatIds[0]);
    return state;
  },

  currentSeat: (state) => (state.finished ? null : state.current),

  legalActions(state, seatId) {
    if (state.finished || state.current !== seatId) return [];
    const h = state.hands[seatId];
    if (h.done) return [];
    return [...DICE.filter((sides) => !isUsed(h, sides)).map((sides) => ({ type: "take", sides })), { type: "stand" }];
  },

  validate(state, seatId, action) {
    if (state.finished) return "finished";
    if (state.current !== seatId) return "notYourTurn";
    if (action?.type === "stand") return null;
    if (action?.type === "take") {
      if (!DICE.includes(action.sides)) return "badDie";
      return isUsed(state.hands[seatId], action.sides) ? "dieUsed" : null;
    }
    return "badAction";
  },

  async apply(input, seatId, action, ctx) {
    const state = clone(input);
    const events = [];
    const h = state.hands[seatId];

    if (action.type === "take") {
      const [[value]] = await ctx.roll([{ sides: action.sides, count: 1 }], { seat: seatId, reason: "tw" });
      h.rolled.push({ sides: action.sides, value });
      h.total += value;
      if (h.total > state.rules.limit) {
        h.bust = true;
        h.done = true;
      } else if (h.rolled.length >= DICE.length) {
        // костей больше нет — рука закрывается сама
        h.stood = true;
        h.done = true;
      }
      events.push({ type: "took", seat: seatId, sides: action.sides, value, total: h.total, bust: h.bust, done: h.done });
      if (h.done) advance(state, events);
    } else if (action.type === "stand") {
      h.stood = true;
      h.done = true;
      events.push({ type: "stood", seat: seatId, total: h.total });
      advance(state, events);
    }
    return { state, events };
  },

  async removeSeat(input, seatId) {
    const state = clone(input);
    const events = [{ type: "left", seat: seatId }];
    if (state.finished || !state.order.includes(seatId)) return { state, events };
    const wasCurrent = state.current === seatId;
    // ушёл открывший круг — его роль переходит следующему, очередь открывающих не сбивается
    if (state.firstSeat === seatId) state.firstSeat = nextInOrder(state.order, seatId, (id) => id !== seatId);
    state.order = state.order.filter((id) => id !== seatId);
    delete state.hands[seatId];
    delete state.wins[seatId];

    if (state.order.length === 1) {
      finishMatch(state, state.order[0], events);
      return { state, events };
    }
    if (wasCurrent) advance(state, events);
    return { state, events };
  },

  publicView: (state) => state,
  privateView: () => null,

  result(state) {
    if (!state.finished) return null;
    return { winners: [state.winner], scores: { ...state.wins } };
  },
};
