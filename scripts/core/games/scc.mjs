/* «Корабль, капитан и команда» (Ship, Captain and Crew).

   Пять костей, у каждого до трёх бросков за ход. Сначала нужна шестёрка (корабль),
   потом пятёрка (капитан), потом четвёрка (команда); найденное в одном броске
   встаёт по порядку. Две оставшиеся кости — груз, сумма — очки. Без команды — ноль.
   Когда команда в сборе, груз можно перебросить оставшимися бросками или остановиться.

   Круг заканчивается, когда сходили все. Лучший груз забирает партию; ничья — переигровка
   только между равными; у всех ноль — переигровка всеми.

   state = {
     maxRolls: number,         // бросков на ход (настройка rolls)
     order: seatId[],          // все места в порядке ходов
     contenders: seatId[],     // кто играет этот круг
     round: number,
     current: seatId | null,
     hands: { [seatId]: Hand },
     winner: seatId | null,
     finished: boolean,
   }
   Hand = { rolls, ship, captain, crew, dice: number[], done, score: number | null }
     dice — кости, которые ещё катаются (без команды) или груз (2 кости, когда команда в сборе)

   Ходы: { type: "roll" } · { type: "stop" }
   События: rolled {seat, values, locked, dice, crew} · handDone {seat, score}
            roundTie {seats, score} · roundVoid {} · won {seat, score}
*/

import { clone, normalizeBySchema, nextInOrder, sum } from "../util.mjs";

const OPTIONS = [{ key: "rolls", type: "number", default: 3, min: 2, max: 5, step: 1 }];

const emptyHand = () => ({ rolls: 0, ship: false, captain: false, crew: false, dice: [], done: false, score: null });

const lockedCount = (h) => Number(h.ship) + Number(h.captain) + Number(h.crew);

function startRound(state, contenders) {
  state.contenders = [...contenders];
  state.round += 1;
  for (const id of contenders) state.hands[id] = emptyHand();
  state.current = contenders[0] ?? null;
}

function finishHand(state, seatId, events) {
  const h = state.hands[seatId];
  h.done = true;
  h.score = h.crew ? sum(h.dice) : 0;
  events.push({ type: "handDone", seat: seatId, score: h.score });
}

/** Ход переходит к следующему, кто ещё не сходил; если сходили все — итог круга. */
function advance(state, events) {
  const next = state.contenders.find((id) => !state.hands[id].done) ?? null;
  if (next) {
    state.current = nextInOrder(state.contenders, state.current, (id) => !state.hands[id].done) ?? next;
    return;
  }
  const scores = state.contenders.map((id) => state.hands[id].score ?? 0);
  const best = Math.max(...scores);
  if (best <= 0) {
    events.push({ type: "roundVoid" });
    startRound(state, state.contenders);
    return;
  }
  const top = state.contenders.filter((id) => state.hands[id].score === best);
  if (top.length === 1) {
    state.winner = top[0];
    state.finished = true;
    state.current = null;
    events.push({ type: "won", seat: top[0], score: best });
    return;
  }
  events.push({ type: "roundTie", seats: top, score: best });
  startRound(state, top);
}

export default {
  id: "scc",
  seats: { min: 2, max: 8 },
  hasSecrets: false,
  options: OPTIONS,

  normalizeOptions: (raw) => normalizeBySchema(OPTIONS, raw),

  async setup({ seatIds, options }) {
    const state = {
      order: [...seatIds],
      contenders: [],
      round: 0,
      current: null,
      hands: {},
      maxRolls: options?.rolls ?? 3,
      winner: null,
      finished: false,
    };
    startRound(state, seatIds);
    return state;
  },

  currentSeat: (state) => (state.finished ? null : state.current),

  legalActions(state, seatId) {
    if (state.finished || state.current !== seatId) return [];
    const h = state.hands[seatId];
    const out = [];
    if (!h.done && h.rolls < state.maxRolls) out.push({ type: "roll" });
    if (!h.done && h.crew && h.rolls > 0) out.push({ type: "stop" });
    return out;
  },

  validate(state, seatId, action) {
    if (state.finished) return "finished";
    if (state.current !== seatId) return "notYourTurn";
    const h = state.hands[seatId];
    if (action?.type === "roll") return h.done || h.rolls >= state.maxRolls ? "noRolls" : null;
    if (action?.type === "stop") return h.crew && h.rolls > 0 && !h.done ? null : "noCrew";
    return "badAction";
  },

  async apply(input, seatId, action, ctx) {
    const state = clone(input);
    const events = [];
    const h = state.hands[seatId];
    const maxRolls = state.maxRolls;

    if (action.type === "roll") {
      const count = h.crew ? 2 : 5 - lockedCount(h);
      const [values] = await ctx.roll([{ sides: 6, count }], { seat: seatId, reason: "scc" });
      const pool = [...values];
      const locked = [];
      if (!h.crew) {
        for (const [need, key, prev] of [[6, "ship", null], [5, "captain", "ship"], [4, "crew", "captain"]]) {
          if (h[key] || (prev && !h[prev])) continue;
          const i = pool.indexOf(need);
          if (i < 0) break;
          pool.splice(i, 1);
          h[key] = true;
          locked.push(need);
        }
      }
      h.dice = pool;
      h.rolls += 1;
      events.push({ type: "rolled", seat: seatId, values, locked, dice: [...h.dice], crew: h.crew });
      if (h.rolls >= maxRolls) {
        finishHand(state, seatId, events);
        advance(state, events);
      }
    } else if (action.type === "stop") {
      finishHand(state, seatId, events);
      advance(state, events);
    }
    return { state, events };
  },

  async removeSeat(input, seatId) {
    const state = clone(input);
    const events = [{ type: "left", seat: seatId }];
    if (state.finished || !state.order.includes(seatId)) return { state, events };
    const wasCurrent = state.current === seatId;
    const nextCurrent = wasCurrent ? nextInOrder(state.contenders, seatId, (id) => id !== seatId && !state.hands[id].done) : null;
    state.order = state.order.filter((id) => id !== seatId);
    state.contenders = state.contenders.filter((id) => id !== seatId);
    delete state.hands[seatId];

    if (state.order.length === 1) {
      state.winner = state.order[0];
      state.finished = true;
      state.current = null;
      events.push({ type: "won", seat: state.winner, score: state.hands[state.winner]?.score ?? 0 });
      return { state, events };
    }
    if (state.contenders.length === 0) {
      startRound(state, state.order);
      return { state, events };
    }
    if (wasCurrent) {
      state.current = nextCurrent ?? state.contenders[0];
      if (state.contenders.every((id) => state.hands[id].done)) advance(state, events);
    } else if (state.contenders.every((id) => state.hands[id].done)) {
      advance(state, events);
    }
    return { state, events };
  },

  publicView: (state) => state,
  privateView: () => null,

  result(state) {
    if (!state.finished) return null;
    const scores = Object.fromEntries(Object.entries(state.hands).map(([id, h]) => [id, h.score ?? 0]));
    return { winners: state.winner ? [state.winner] : [], draw: !state.winner, scores };
  },
};
