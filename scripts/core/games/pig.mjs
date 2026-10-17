/* «Свинья» (Pig).

   Кубики к6. В свой ход игрок бросает сколько угодно раз: очки всех кубиков копятся в очках хода.
   После любого броска можно записать очки хода в счёт — ход переходит дальше. Выпала хоть одна
   единица — очки хода сгорают, ход переходит. Кто набрал цель (счёт плюс очки хода), побеждает
   сразу, записывать не нужно.

   Настройки: dice — сколько кубиков в броске; grow — каждый следующий бросок хода на кубик больше
   (с dice до шести); snakeEyes — две единицы и больше в одном броске сжигают и весь записанный счёт;
   maxTurns — предел ходов на каждого (0 — без предела): когда каждый сыграл столько ходов, побеждает
   больший счёт, при равенстве — все, у кого он больший.

   state = {
     order: seatId[],                    // места в порядке ходов
     rules: { target, dice, grow, snakeEyes, maxTurns },
     scores: { [seatId]: number },
     turns: { [seatId]: number },        // сколько ходов место уже сыграло
     current: seatId | null,
     turn: {
       rolls: number[][],  // броски хода по порядку, в каждом — выпавшие кубики (пусто до первого броска)
       points: number,     // очки хода
     },
     winners: seatId[],                  // пусто, пока партия идёт
     byLimit: boolean,                   // кончилась пределом ходов, а не целью
     finished: boolean,
   }
   После победы turn остаётся таким, каким был в момент победы (для показа последнего хода).

   Ходы: { type: "roll" } · { type: "hold" } — записать очки хода
   События: rolled {seat, values} · bust {seat, lost, rolls, wiped?} — wiped: сколько счёта сгорело
            от двух единиц · held {seat, points, total} · won {seat, total, byLimit?} · left {seat}
   Ошибки: finished · notYourTurn · badAction · mustRoll
*/

import { clone, normalizeBySchema, nextInOrder, sum } from "../util.mjs";

const MAX_DICE = 6;

const OPTIONS = [
  { key: "target", type: "number", default: 100, min: 50, max: 500, step: 10 },
  { key: "dice", type: "number", default: 1, min: 1, max: MAX_DICE, step: 1 },
  { key: "grow", type: "bool", default: false },
  { key: "snakeEyes", type: "bool", default: false },
  { key: "maxTurns", type: "number", default: 0, min: 0, max: 100, step: 1 },
];

/** Грань, на которой сгорает ход. */
export const BUST = 1;

/** Сколько кубиков в броске хода, если до него брошено rolls раз. */
export const diceFor = (rules, rolls) => (rules.grow ? Math.min(MAX_DICE, rules.dice + rolls) : rules.dice);

/** Может ли за этим столом в одном броске выпасть больше одного кубика. */
export const manyDice = (rules) => rules.dice > 1 || rules.grow;

const freshTurn = () => ({ rolls: [], points: 0 });

function win(state, seatIds, events, byLimit = false) {
  state.winners = [...seatIds];
  state.byLimit = byLimit;
  state.finished = true;
  state.current = null;
  for (const id of seatIds) events.push({ type: "won", seat: id, total: state.scores[id] ?? 0, ...(byLimit && { byLimit }) });
}

/** Все сыграли предел ходов — побеждает больший счёт. */
function outOfTurns(state, events) {
  const { maxTurns } = state.rules;
  if (!maxTurns || state.order.some((id) => state.turns[id] < maxTurns)) return false;
  const top = Math.max(...state.order.map((id) => state.scores[id]));
  win(state, state.order.filter((id) => state.scores[id] === top), events, true);
  return true;
}

/** Ход окончен: засчитать его месту и передать дальше (или закончить партию по пределу). */
function endTurn(state, events) {
  state.turns[state.current] += 1;
  if (outOfTurns(state, events)) return;
  state.current = nextInOrder(state.order, state.current);
  state.turn = freshTurn();
}

/** Записать очки хода; набрана цель — победа, иначе ход дальше. */
function hold(state, seatId, events) {
  const t = state.turn;
  state.scores[seatId] += t.points;
  events.push({ type: "held", seat: seatId, points: t.points, total: state.scores[seatId] });
  if (state.scores[seatId] >= state.rules.target) win(state, [seatId], events);
  else endTurn(state, events);
}

export default {
  id: "pig",
  seats: { min: 2, max: 6 },
  hasSecrets: false,
  options: OPTIONS,

  normalizeOptions: (raw) => normalizeBySchema(OPTIONS, raw),

  async setup({ seatIds, options }) {
    return {
      order: [...seatIds],
      rules: normalizeBySchema(OPTIONS, options),
      scores: Object.fromEntries(seatIds.map((id) => [id, 0])),
      turns: Object.fromEntries(seatIds.map((id) => [id, 0])),
      current: seatIds[0] ?? null,
      turn: freshTurn(),
      winners: [],
      byLimit: false,
      finished: false,
    };
  },

  currentSeat: (state) => (state.finished ? null : state.current),

  legalActions(state, seatId) {
    if (state.finished || state.current !== seatId) return [];
    return state.turn.rolls.length ? [{ type: "roll" }, { type: "hold" }] : [{ type: "roll" }];
  },

  validate(state, seatId, action) {
    if (state.finished) return "finished";
    if (state.current !== seatId) return "notYourTurn";
    if (action?.type === "roll") return null;
    if (action?.type === "hold") return state.turn.rolls.length ? null : "mustRoll";
    return "badAction";
  },

  async apply(input, seatId, action, ctx) {
    const state = clone(input);
    const events = [];
    const t = state.turn;

    if (action.type === "roll") {
      const count = diceFor(state.rules, t.rolls.length);
      const [values] = await ctx.roll([{ sides: 6, count }], { seat: seatId, reason: "pig" });
      t.rolls.push([...values]);
      events.push({ type: "rolled", seat: seatId, values: [...values] });
      const ones = values.filter((v) => v === BUST).length;
      if (ones > 0) {
        const bust = { type: "bust", seat: seatId, lost: t.points, rolls: clone(t.rolls) };
        if (ones >= 2 && state.rules.snakeEyes) {
          bust.wiped = state.scores[seatId];
          state.scores[seatId] = 0;
        }
        events.push(bust);
        endTurn(state, events);
      } else {
        t.points += sum(values);
        // Цель набрана — очки записываются сами, жать «Записать» не нужно.
        if (state.scores[seatId] + t.points >= state.rules.target) hold(state, seatId, events);
      }
    } else if (action.type === "hold") {
      hold(state, seatId, events);
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
    delete state.turns[seatId];

    if (state.order.length === 1) {
      win(state, state.order, events);
      return { state, events };
    }
    // Ушёл тот, кто один ещё не доиграл предел, — партия кончается.
    if (outOfTurns(state, events)) return { state, events };
    if (wasCurrent) {
      state.current = next;
      state.turn = freshTurn();
    }
    return { state, events };
  },

  publicView: (state) => state,
  privateView: () => null,

  result(state) {
    if (!state.finished) return null;
    return { winners: [...state.winners], scores: { ...state.scores } };
  },
};
