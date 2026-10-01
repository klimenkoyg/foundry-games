/* «Кости лжеца» (Liar's Dice / Perudo).

   У каждого стаканчик с костями, которые видит только он. По очереди делают ставку:
   «на всём столе не меньше q костей с гранью f». Каждая ставка выше прежней: больше q
   или то же q с гранью старше. Вместо ставки можно вскрыть прежнюю: «Не верю!» (challenge)
   или, если разрешено, «В точку!» (spotOn — ровно q). Стаканчики открываются и считаются
   (единицы — джокеры, если включено; тогда на единицы ставить нельзя).

   Не верю: набралось q или больше — кость теряет вскрывший, иначе — ставивший.
   В точку: ровно q — вскрывший возвращает кость (не больше стартового числа), иначе теряет.
   Без костей — выбыл. Последний с костями забирает партию. Новый круг открывает
   потерявший кость (после верного «В точку!» — вскрывший); выбыл — следующий за ним.

   state = {
     order: seatId[],
     rules: { dice, onesWild, spotOn },
     counts: { [seatId]: number },     // сколько костей осталось; 0 — выбыл
     cups: { [seatId]: number[] },     // СЕКРЕТ — только в полном состоянии
     round: number,                    // с 1
     starter: seatId,                  // кто открыл круг
     current: seatId | null,
     phase: "bidding" | "reveal",
     bid: { seat, q, f } | null,       // старшая ставка
     history: [{ seat, q, f }],        // ставки круга по порядку
     reveal: null | { cups, bid, call: "challenge" | "spotOn", caller, actual, loser, gainer },
     winner: seatId | null,
     finished: boolean,
   }
   reveal живёт до первой ставки нового круга; его cups — уже открытые кости прошлого круга.

   Ходы: { type: "bid", q, f } · { type: "challenge" } · { type: "spotOn" }
         { type: "next" } — только в фазе reveal: новый круг открывает current
   События: bid {seat, q, f} · challenge {seat, bid} · spotOn {seat, bid}
            revealed {cups, bid, call, caller, actual, loser, gainer} · out {seat}
            round {round, starter} · won {seat} · left {seat}
   Ошибки: finished · notYourTurn · badAction · wrongPhase · noBid · lowBid · badFace
           badQuantity · spotOnOff · ownBid
*/

import { clamp, clone, normalizeBySchema, nextInOrder, sum } from "../util.mjs";

const OPTIONS = [
  { key: "dice", type: "number", default: 5, min: 3, max: 6, step: 1 },
  { key: "onesWild", type: "bool", default: true },
  { key: "spotOn", type: "bool", default: true },
];

/** Грани, на которые можно ставить: с джокерами единицы не называют. */
export const allowedFaces = (rules) => (rules?.onesWild ? [2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6]);

/** Ставка (q, f) выше прежней: больше костей или столько же, но грань старше. */
export function isHigherBid(prev, q, f) {
  if (!prev) return true;
  return q > prev.q || (q === prev.q && f > prev.f);
}

/** Сколько костей на столе играет за грань face (единицы — джокеры, если onesWild). */
export function countMatches(cups, face, onesWild) {
  let n = 0;
  for (const cup of Object.values(cups ?? {})) {
    for (const v of cup ?? []) if (v === face || (onesWild && v === 1)) n++;
  }
  return n;
}

/**
 * Вероятность, что на столе не меньше q костей с гранью f, если свой стаканчик известен,
 * а чужих костей unknownDice. Биномиальное распределение.
 */
export function bidProbability(q, f, ownCup, unknownDice, onesWild) {
  const need = q - countMatches({ own: ownCup ?? [] }, f, onesWild);
  if (need <= 0) return 1;
  if (need > unknownDice) return 0;
  const p = onesWild && f !== 1 ? 1 / 3 : 1 / 6;
  let below = 0;
  let term = (1 - p) ** unknownDice; // P(X = 0)
  for (let k = 0; k < need; k++) {
    below += term;
    term *= ((unknownDice - k) / (k + 1)) * (p / (1 - p));
  }
  return clamp(1 - below, 0, 1);
}

const totalDice = (state) => sum(Object.values(state.counts));

const isActive = (state) => (id) => state.counts[id] > 0;

const activeSeats = (state) => state.order.filter(isActive(state));

/** Новые стаканчики всем, у кого есть кости: каждому — свой тайный бросок. */
async function rollCups(state, ctx) {
  state.cups = {};
  for (const id of activeSeats(state)) {
    const [cup] = await ctx.roll([{ sides: 6, count: state.counts[id] }], { seat: id, secret: true, reason: "liars" });
    state.cups[id] = cup;
  }
}

function win(state, seatId, events) {
  state.winner = seatId;
  state.finished = true;
  state.current = null;
  events.push({ type: "won", seat: seatId });
}

/** Вскрытие: считает кости, двигает счёт и назначает того, кто откроет новый круг. */
function resolve(state, seatId, call, events) {
  const bid = { ...state.bid };
  const actual = countMatches(state.cups, bid.f, state.rules.onesWild);
  let loser = null;
  let gainer = null;
  if (call === "challenge") loser = actual >= bid.q ? seatId : bid.seat;
  else if (actual !== bid.q) loser = seatId;
  else if (state.counts[seatId] < state.rules.dice) gainer = seatId;
  // Ставивший мог уйти из-за стола — тогда кость никто не теряет.
  if (loser !== null && !state.order.includes(loser)) loser = null;

  if (loser !== null) state.counts[loser] -= 1;
  if (gainer !== null) state.counts[gainer] += 1;
  state.phase = "reveal";
  state.reveal = { cups: clone(state.cups), bid, call, caller: seatId, actual, loser, gainer };

  events.push({ type: call, seat: seatId, bid: { ...bid } });
  events.push({ type: "revealed", ...clone(state.reveal) });
  if (loser !== null && state.counts[loser] === 0) events.push({ type: "out", seat: loser });

  const alive = activeSeats(state);
  if (alive.length <= 1) {
    win(state, alive[0] ?? null, events);
    return;
  }
  const from = loser ?? seatId;
  state.current = state.counts[from] > 0 ? from : nextInOrder(state.order, from, isActive(state));
}

export default {
  id: "liars",
  seats: { min: 2, max: 6 },
  hasSecrets: true,
  options: OPTIONS,

  normalizeOptions: (raw) => normalizeBySchema(OPTIONS, raw),

  async setup({ seatIds, options, ctx }) {
    const rules = {
      dice: options?.dice ?? 5,
      onesWild: options?.onesWild ?? true,
      spotOn: options?.spotOn ?? true,
    };
    const state = {
      order: [...seatIds],
      rules,
      counts: Object.fromEntries(seatIds.map((id) => [id, rules.dice])),
      cups: {},
      round: 1,
      starter: seatIds[0] ?? null,
      current: seatIds[0] ?? null,
      phase: "bidding",
      bid: null,
      history: [],
      reveal: null,
      winner: null,
      finished: false,
    };
    await rollCups(state, ctx);
    return state;
  },

  currentSeat: (state) => (state.finished ? null : state.current),

  legalActions(state, seatId) {
    if (state.finished || state.current !== seatId) return [];
    if (state.phase === "reveal") return [{ type: "next" }];
    const out = [];
    const canCall = Boolean(state.bid) && state.bid.seat !== seatId;
    if (canCall) out.push({ type: "challenge" });
    if (canCall && state.rules.spotOn) out.push({ type: "spotOn" });
    const total = totalDice(state);
    const faces = allowedFaces(state.rules);
    for (let q = 1; q <= total; q++) {
      for (const f of faces) if (isHigherBid(state.bid, q, f)) out.push({ type: "bid", q, f });
    }
    return out;
  },

  validate(state, seatId, action) {
    if (state.finished) return "finished";
    if (state.current !== seatId) return "notYourTurn";
    const type = action?.type;
    if (type === "next") return state.phase === "reveal" ? null : "wrongPhase";
    if (type !== "bid" && type !== "challenge" && type !== "spotOn") return "badAction";
    if (state.phase !== "bidding") return "wrongPhase";

    if (type === "bid") {
      if (!allowedFaces(state.rules).includes(action.f)) return "badFace";
      if (!Number.isInteger(action.q) || action.q < 1 || action.q > totalDice(state)) return "badQuantity";
      return isHigherBid(state.bid, action.q, action.f) ? null : "lowBid";
    }
    if (type === "spotOn" && !state.rules.spotOn) return "spotOnOff";
    if (!state.bid) return "noBid";
    return state.bid.seat === seatId ? "ownBid" : null;
  },

  async apply(input, seatId, action, ctx) {
    const state = clone(input);
    const events = [];

    if (action.type === "bid") {
      const bid = { seat: seatId, q: action.q, f: action.f };
      state.bid = bid;
      state.history.push({ ...bid });
      state.reveal = null;
      events.push({ type: "bid", ...bid });
      state.current = nextInOrder(state.order, seatId, isActive(state));
    } else if (action.type === "challenge" || action.type === "spotOn") {
      resolve(state, seatId, action.type, events);
    } else if (action.type === "next") {
      state.round += 1;
      state.starter = seatId;
      state.phase = "bidding";
      state.bid = null;
      state.history = [];
      await rollCups(state, ctx);
      events.push({ type: "round", round: state.round, starter: seatId });
    }
    return { state, events };
  },

  async removeSeat(input, seatId) {
    const state = clone(input);
    const events = [{ type: "left", seat: seatId }];
    if (state.finished || !state.order.includes(seatId)) return { state, events };
    // Очередь считаем до удаления: следующий за ушедшим, у кого есть кости.
    const heir = nextInOrder(state.order, seatId, (id) => id !== seatId && state.counts[id] > 0);
    const wasCurrent = state.current === seatId;
    state.order = state.order.filter((id) => id !== seatId);
    delete state.counts[seatId];
    delete state.cups[seatId];

    const alive = activeSeats(state);
    if (alive.length <= 1) {
      win(state, alive[0] ?? null, events);
      return { state, events };
    }
    // Ставка ушедшего остаётся на столе: её можно перебить или вскрыть.
    if (wasCurrent) state.current = heir;
    if (state.starter === seatId) state.starter = heir;
    return { state, events };
  },

  publicView(state) {
    const { cups, ...open } = state;
    return { ...clone(open), totalDice: totalDice(state) };
  },

  privateView(state, seatId) {
    const cup = state.cups?.[seatId];
    return cup && state.counts[seatId] > 0 ? { cup: [...cup] } : null;
  },

  result(state) {
    if (!state.finished) return null;
    return { winners: state.winner ? [state.winner] : [], scores: { ...state.counts } };
  },
};
