/* «Кнаклбоунс» (Knucklebones) — дуэль на костях, как в Cult of the Lamb.

   У каждого своя доска: три столбца по три места. В свой ход у игрока уже брошена
   кость — её нужно поставить в любой свой незаполненный столбец. Все кости того же
   значения в том же столбце соперника выбиваются. Очки столбца: каждое значение v,
   стоящее n раз, даёт v × n × n (две четвёрки — 16, три — 36). Очки доски — сумма столбцов.

   Партия кончается сразу, как только чья-то доска заполнена (9 костей).
   Больше очков — победа, поровну — ничья.

   state = {
     order: [seatId, seatId],
     current: seatId | null,
     boards: { [seatId]: [number[], number[], number[]] },   // столбец — значения в порядке постановки, до 3
     die: number | null,       // брошенная кость, которую ставит текущий
     turnCount: number,        // сколько костей уже поставлено
     totals: { [seatId]: number },   // очки досок, верны после каждой постановки
     winner: seatId | null,
     draw: boolean,
     finished: boolean,
   }

   Ходы: { type: "place", col }   // col — 0..2, свой столбец с местом
   События: placed {seat, col, value, knocked} · rolledDie {seat, value}
            won {seat, totals} · draw {totals} · left {seat}
   Ошибки: finished · notYourTurn · badAction · badCol · colFull
*/

import { clone, counts, sum } from "../util.mjs";

const COLS = 3;
const SLOTS = 3;

/** Очки столбца: значение × число таких костей в квадрате. */
export function columnScore(column) {
  return counts(column).reduce((total, n, v) => total + v * n * n, 0);
}

/** Очки доски — сумма столбцов. */
export const boardScore = (board) => sum(board.map(columnScore));

const emptyBoard = () => Array.from({ length: COLS }, () => []);

const isFull = (board) => board.every((column) => column.length >= SLOTS);

const otherSeat = (state, seatId) => state.order.find((id) => id !== seatId) ?? null;

const isCol = (col) => Number.isInteger(col) && col >= 0 && col < COLS;

async function rollDieFor(state, seatId, ctx) {
  const [[value]] = await ctx.roll([{ sides: 6, count: 1 }], { seat: seatId, reason: "kb" });
  state.die = value;
  return value;
}

function updateTotals(state) {
  for (const id of state.order) state.totals[id] = boardScore(state.boards[id]);
}

function finish(state, winner, events) {
  state.winner = winner;
  state.draw = !winner;
  state.finished = true;
  state.current = null;
  state.die = null;
  const totals = { ...state.totals };
  events.push(winner ? { type: "won", seat: winner, totals } : { type: "draw", totals });
}

export default {
  id: "kb",
  seats: { min: 2, max: 2 },
  hasSecrets: false,
  options: [],

  normalizeOptions: () => ({}),

  async setup({ seatIds, ctx }) {
    const order = [...seatIds];
    const state = {
      order,
      current: order[0],
      boards: Object.fromEntries(order.map((id) => [id, emptyBoard()])),
      die: null,
      turnCount: 0,
      totals: Object.fromEntries(order.map((id) => [id, 0])),
      winner: null,
      draw: false,
      finished: false,
    };
    await rollDieFor(state, state.current, ctx);
    return state;
  },

  currentSeat: (state) => (state.finished ? null : state.current),

  legalActions(state, seatId) {
    if (state.finished || state.current !== seatId) return [];
    const out = [];
    state.boards[seatId].forEach((column, col) => {
      if (column.length < SLOTS) out.push({ type: "place", col });
    });
    return out;
  },

  validate(state, seatId, action) {
    if (state.finished) return "finished";
    if (state.current !== seatId) return "notYourTurn";
    if (action?.type !== "place") return "badAction";
    if (!isCol(action.col)) return "badCol";
    return state.boards[seatId][action.col].length >= SLOTS ? "colFull" : null;
  },

  async apply(input, seatId, action, ctx) {
    const state = clone(input);
    const events = [];
    const foe = otherSeat(state, seatId);
    const { col } = action;
    const value = state.die;

    state.boards[seatId][col].push(value);
    const before = state.boards[foe][col];
    state.boards[foe][col] = before.filter((v) => v !== value);
    const knocked = before.length - state.boards[foe][col].length;
    state.turnCount += 1;
    updateTotals(state);
    events.push({ type: "placed", seat: seatId, col, value, knocked });

    if (state.order.some((id) => isFull(state.boards[id]))) {
      const [a, b] = state.order;
      const diff = state.totals[a] - state.totals[b];
      finish(state, diff > 0 ? a : diff < 0 ? b : null, events);
      return { state, events };
    }

    state.current = foe;
    const next = await rollDieFor(state, foe, ctx);
    events.push({ type: "rolledDie", seat: foe, value: next });
    return { state, events };
  },

  /** Дуэль: ушёл один — второй выиграл. Доски остаются, чтобы стол показал итог. */
  async removeSeat(input, seatId) {
    const state = clone(input);
    const events = [{ type: "left", seat: seatId }];
    if (state.finished || !state.order.includes(seatId)) return { state, events };
    finish(state, otherSeat(state, seatId), events);
    return { state, events };
  },

  publicView: (state) => state,
  privateView: () => null,

  result(state) {
    if (!state.finished) return null;
    return { winners: state.winner ? [state.winner] : [], draw: state.draw, scores: { ...state.totals } };
  },
};
