/* «Покер на костях» (как в «Ведьмаке»).

   Раздача: каждый бросает пять костей в открытую. Круг ставок (если ставки включены) →
   каждый, кто не сбросил, один раз перебрасывает любые свои кости → второй круг ставок →
   вскрытие. Лучшая комбинация берёт раздачу; равенство наверху — раздача ничья.
   Кто первым взял handsToWin раздач — забирает партию и весь банк. Сброс отдаёт только
   текущую раздачу. Ставки копятся всю партию; игра лишь считает вклады, расчёт — за ведущим.

   Комбинации по возрастанию — HAND_RANKS: ничего, пара, две пары, тройка,
   малый стрит (1-2-3-4-5), большой стрит (2-3-4-5-6), фулл-хаус, каре, покер.

   state = {
     order: seatId[],
     rules: { handsToWin, betting, raise, maxRaises },
     handWins: { [seatId]: number },
     handNo: number,                  // с единицы
     dealer: seatId,                  // ходит первым в раздаче; каждую раздачу — следующий по кругу
     phase: "bet1" | "reroll" | "bet2",
     current: seatId | null,
     dice: { [seatId]: number[] },    // по пять костей, открыты
     folded: { [seatId]: boolean },
     rerolled: { [seatId]: boolean }, // кто уже перебросил в этой раздаче
     bets: { [seatId]: number },      // вклад за всю партию (сверх входной ставки)
     round: { highest, put: { [seatId]: number }, raises, acted: { [seatId]: boolean } },  // текущий круг ставок
     lastHand: { winner: seatId | null, hands: { [seatId]: { values, rank, name } }, handNo, byFold } | null,
     leftBets: { [seatId]: number },  // вклады ушедших из-за стола — чтобы ведущий мог их рассчитать
     winner: seatId | null,
     finished: boolean,
   }

   Ходы: { type: "check" } · { type: "bet" } · { type: "call" } · { type: "fold" }
         { type: "reroll", indices: number[] }   // разные индексы 0..4; пусто — оставить всё
   События: dealt {handNo, hands} · checked {seat} · bet {seat, highest} · called {seat, highest}
            folded {seat} · rerolled {seat, indices, values} · showdown {hands, winner}
            handWon {seat, handNo} · handDraw {handNo} · won {seat} · left {seat}
   Первая раздача бросается в setup и события не даёт — она видна в состоянии.
   Кости раздаются по одному броску на место, начиная со сдающего.
*/

import { clone, counts, nextInOrder, normalizeBySchema, subsets } from "../util.mjs";

const OPTIONS = [
  { key: "handsToWin", type: "number", default: 2, min: 1, max: 3, step: 1 },
  { key: "betting", type: "bool", default: true },
  { key: "raise", type: "number", default: 5, min: 1, max: 1000, step: 1 },
  { key: "maxRaises", type: "number", default: 2, min: 1, max: 4, step: 1 },
];

export const HAND_RANKS = ["nothing", "pair", "twoPairs", "three", "smallStraight", "bigStraight", "fullHouse", "four", "five"];

// Комбинация по числу одинаковых граней: «32» — три и две.
const SHAPES = { 5: "five", 41: "four", 32: "fullHouse", 311: "three", 221: "twoPairs", 2111: "pair" };

const ACTIONS = ["check", "bet", "call", "fold", "reroll"];

const REROLLS = [[], ...subsets(5)];

/** Комбинация пяти костей: ранг, имя и грани для сравнения равных (сперва по числу, потом по старшинству). */
export function evaluateHand(values) {
  const c = counts(values);
  const groups = [];
  for (let face = 6; face >= 1; face--) if (c[face]) groups.push([c[face], face]);
  groups.sort((x, y) => y[0] - x[0] || y[1] - x[1]);
  const shape = groups.map((g) => g[0]).join("");
  let name = SHAPES[shape] ?? "nothing";
  if (shape === "11111") name = !c[6] ? "smallStraight" : !c[1] ? "bigStraight" : "nothing";
  const straight = name === "smallStraight" || name === "bigStraight";
  return { rank: HAND_RANKS.indexOf(name), name, tiebreak: straight ? [] : groups.map((g) => g[1]) };
}

const evaluated = (h) => (Array.isArray(h) ? evaluateHand(h) : h.tiebreak ? h : evaluateHand(h.values));

/** Больше нуля — a сильнее. Принимает и кости, и уже оценённые комбинации. */
export function compareHands(a, b) {
  const x = evaluated(a);
  const y = evaluated(b);
  if (x.rank !== y.rank) return x.rank - y.rank;
  const n = Math.max(x.tiebreak.length, y.tiebreak.length);
  for (let i = 0; i < n; i++) {
    const d = (x.tiebreak[i] ?? 0) - (y.tiebreak[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const fill = (ids, value) => Object.fromEntries(ids.map((id) => [id, value]));

const newRound = (ids) => ({ highest: 0, put: fill(ids, 0), raises: 0, acted: fill(ids, false) });

/** Места по кругу, начиная с id. */
function orderFrom(order, id) {
  const i = Math.max(0, order.indexOf(id));
  return [...order.slice(i), ...order.slice(0, i)];
}

const alive = (state) => state.order.filter((id) => !state.folded[id]);

const shown = (values) => {
  const { rank, name } = evaluateHand(values);
  return { values: [...values], rank, name };
};

/** Должно ли место ещё сходить в этой фазе. */
function needsTurn(state, id) {
  if (state.folded[id]) return false;
  if (state.phase === "reroll") return !state.rerolled[id];
  return !state.round.acted[id] || state.round.put[id] < state.round.highest;
}

async function deal(state, ctx, events) {
  state.dice = {};
  for (const id of orderFrom(state.order, state.dealer)) {
    const [values] = await ctx.roll([{ sides: 6, count: 5 }], { seat: id, reason: "poker" });
    state.dice[id] = [...values];
  }
  state.folded = fill(state.order, false);
  state.rerolled = fill(state.order, false);
  state.round = newRound(state.order);
  state.phase = state.rules.betting ? "bet1" : "reroll";
  state.current = state.dealer;
  events?.push({ type: "dealt", handNo: state.handNo, hands: clone(state.dice) });
}

/** Итог раздачи: победа в счёт, затем конец партии или новая раздача со следующим сдающим. */
async function closeHand(state, winner, hands, byFold, events, ctx) {
  state.lastHand = { winner, hands, handNo: state.handNo, byFold };
  if (winner) {
    state.handWins[winner] += 1;
    events.push({ type: "handWon", seat: winner, handNo: state.handNo });
  } else {
    events.push({ type: "handDraw", handNo: state.handNo });
  }
  if (winner && state.handWins[winner] >= state.rules.handsToWin) {
    state.winner = winner;
    state.finished = true;
    state.current = null;
    events.push({ type: "won", seat: winner });
    return;
  }
  state.handNo += 1;
  state.dealer = nextInOrder(state.order, state.dealer);
  await deal(state, ctx, events);
}

async function showdown(state, events, ctx) {
  const live = alive(state);
  const hands = Object.fromEntries(live.map((id) => [id, shown(state.dice[id])]));
  const best = live.reduce((top, id) => (compareHands(state.dice[id], state.dice[top]) > 0 ? id : top), live[0]);
  const top = live.filter((id) => compareHands(state.dice[id], state.dice[best]) === 0);
  const winner = top.length === 1 ? top[0] : null;
  events.push({ type: "showdown", hands, winner });
  await closeHand(state, winner, hands, false, events, ctx);
}

/** Ход переходит к первому из queue, кому ещё надо сходить; если некому — следующая фаза. */
async function advance(state, queue, events, ctx) {
  const live = alive(state);
  if (live.length === 1) {
    const [seat] = live;
    await closeHand(state, seat, { [seat]: shown(state.dice[seat]) }, true, events, ctx);
    return;
  }
  const next = queue.find((id) => needsTurn(state, id));
  if (next) {
    state.current = next;
    return;
  }
  if (state.phase === "bet1") {
    state.phase = "reroll";
  } else if (state.phase === "reroll" && state.rules.betting) {
    state.phase = "bet2";
    state.round = newRound(state.order);
  } else {
    await showdown(state, events, ctx);
    return;
  }
  state.current = orderFrom(state.order, state.dealer).find((id) => !state.folded[id]) ?? null;
}

export default {
  id: "poker",
  seats: { min: 2, max: 4 },
  hasSecrets: false,
  options: OPTIONS,

  normalizeOptions: (raw) => normalizeBySchema(OPTIONS, raw),

  async setup({ seatIds, options, ctx }) {
    const order = [...seatIds];
    const state = {
      order,
      rules: normalizeBySchema(OPTIONS, options),
      handWins: fill(order, 0),
      handNo: 1,
      dealer: order[0],
      phase: "reroll",
      current: null,
      dice: {},
      folded: {},
      rerolled: {},
      bets: fill(order, 0),
      round: newRound(order),
      lastHand: null,
      leftBets: {},
      winner: null,
      finished: false,
    };
    await deal(state, ctx);
    return state;
  },

  currentSeat: (state) => (state.finished ? null : state.current),

  legalActions(state, seatId) {
    if (state.finished || state.current !== seatId) return [];
    if (state.phase === "reroll") return REROLLS.map((indices) => ({ type: "reroll", indices: [...indices] }));
    const { round } = state;
    const out = [{ type: round.put[seatId] < round.highest ? "call" : "check" }];
    if (round.raises < state.rules.maxRaises) out.push({ type: "bet" });
    out.push({ type: "fold" });
    return out;
  },

  validate(state, seatId, action) {
    if (state.finished) return "finished";
    if (state.current !== seatId) return "notYourTurn";
    const type = action?.type;
    if (!ACTIONS.includes(type)) return "badAction";
    if ((type === "reroll") !== (state.phase === "reroll")) return "wrongPhase";
    if (type === "reroll") {
      const idx = action.indices;
      const ok = Array.isArray(idx) && idx.every((i) => Number.isInteger(i) && i >= 0 && i < 5) && new Set(idx).size === idx.length;
      return ok ? null : "badIndices";
    }
    const { round } = state;
    const owes = round.put[seatId] < round.highest;
    if (type === "check") return owes ? "cannotCheck" : null;
    if (type === "call") return owes ? null : "cannotCall";
    if (type === "bet") return round.raises < state.rules.maxRaises ? null : "noRaises";
    return null;
  },

  async apply(input, seatId, action, ctx) {
    const state = clone(input);
    const events = [];
    const { round } = state;
    // Доложить до уровня: разница уходит в общий вклад за партию.
    const putUp = (level) => {
      state.bets[seatId] += level - round.put[seatId];
      round.put[seatId] = level;
    };

    if (action.type === "reroll") {
      const indices = [...action.indices];
      if (indices.length) {
        const [values] = await ctx.roll([{ sides: 6, count: indices.length }], { seat: seatId, reason: "poker" });
        indices.forEach((i, k) => {
          state.dice[seatId][i] = values[k];
        });
      }
      state.rerolled[seatId] = true;
      events.push({ type: "rerolled", seat: seatId, indices, values: [...state.dice[seatId]] });
    } else if (action.type === "check") {
      round.acted[seatId] = true;
      events.push({ type: "checked", seat: seatId });
    } else if (action.type === "bet") {
      round.highest += state.rules.raise;
      round.raises += 1;
      putUp(round.highest);
      // После повышения всем остальным отвечать заново.
      for (const id of state.order) round.acted[id] = id === seatId;
      events.push({ type: "bet", seat: seatId, highest: round.highest });
    } else if (action.type === "call") {
      putUp(round.highest);
      round.acted[seatId] = true;
      events.push({ type: "called", seat: seatId, highest: round.highest });
    } else if (action.type === "fold") {
      state.folded[seatId] = true;
      round.acted[seatId] = true;
      events.push({ type: "folded", seat: seatId });
    }
    await advance(state, orderFrom(state.order, seatId).slice(1), events, ctx);
    return { state, events };
  },

  async removeSeat(input, seatId, ctx) {
    const state = clone(input);
    const events = [{ type: "left", seat: seatId }];
    if (state.finished || !state.order.includes(seatId)) return { state, events };
    const wasCurrent = state.current === seatId;
    const after = orderFrom(state.order, seatId).slice(1);
    state.order = state.order.filter((id) => id !== seatId);
    if (state.dealer === seatId) state.dealer = after[0];
    state.leftBets = { ...state.leftBets, [seatId]: state.bets[seatId] ?? 0 };
    for (const map of [state.handWins, state.dice, state.folded, state.rerolled, state.bets, state.round.put, state.round.acted]) {
      delete map[seatId];
    }

    if (state.order.length === 1) {
      state.winner = state.order[0];
      state.finished = true;
      state.current = null;
      events.push({ type: "won", seat: state.winner });
      return { state, events };
    }
    // Ушедшему не отвечают: уровень ставки — по тем, кто остался в раздаче.
    state.round.highest = Math.max(0, ...alive(state).map((id) => state.round.put[id]));
    await advance(state, wasCurrent ? after : orderFrom(state.order, state.current), events, ctx);
    return { state, events };
  },

  publicView: (state) => state,
  privateView: () => null,

  result(state) {
    if (!state.finished) return null;
    return { winners: state.winner ? [state.winner] : [], scores: state.handWins, extra: state.bets, leftBets: state.leftBets };
  },
};
