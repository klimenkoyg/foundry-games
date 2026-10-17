import assert from "node:assert/strict";
import { test } from "node:test";

import bot, { breakEven, estimateTurns } from "../scripts/core/bots/pig.mjs";
import { GameError, makeScriptedCtx, runAction } from "../scripts/core/engine.mjs";
import pig, { diceFor, manyDice } from "../scripts/core/games/pig.mjs";
import { TEMPERAMENT_IDS, temperament } from "../scripts/core/temperaments.mjs";
import { mulberry32 } from "../scripts/core/util.mjs";
import { simulate } from "./helpers/sim.mjs";

const setup = (seatIds = ["a", "b"], options = {}) =>
  pig.setup({ seatIds, options: pig.normalizeOptions(options), ctx: makeScriptedCtx([]) });

const roll = { type: "roll" };
const hold = { type: "hold" };
const types = (events) => events.map((e) => e.type);

/** Бросить подряд за текущее место: число — один кубик, массив — несколько. */
async function rolls(state, throws) {
  let events = [];
  for (const t of throws) {
    const res = await pig.apply(state, state.current, roll, makeScriptedCtx([Array.isArray(t) ? t : [t]]));
    state = res.state;
    events = events.concat(res.events);
  }
  return { state, events };
}

// ---------- настройки и начало ----------

test("настройки: значения по умолчанию и границы", () => {
  assert.deepEqual(pig.normalizeOptions({}), { target: 100, dice: 1, grow: false, snakeEyes: false, maxTurns: 0 });
  assert.equal(pig.normalizeOptions({ maxTurns: -3 }).maxTurns, 0);
  assert.equal(pig.normalizeOptions({ maxTurns: 500 }).maxTurns, 100);
  assert.equal(pig.normalizeOptions({ target: 5 }).target, 50);
  assert.equal(pig.normalizeOptions({ target: 9999 }).target, 500);
  assert.equal(pig.normalizeOptions({ target: 124 }).target, 120);
  assert.equal(pig.normalizeOptions({ target: "abc" }).target, 100);
  assert.equal(pig.normalizeOptions({ dice: 0 }).dice, 1);
  assert.equal(pig.normalizeOptions({ dice: 9 }).dice, 6);
  assert.equal(pig.normalizeOptions({ grow: "yes" }).grow, false);
});

test("diceFor и manyDice: сколько кубиков в броске", () => {
  const rules = (o) => pig.normalizeOptions(o);
  assert.deepEqual([0, 1, 5].map((r) => diceFor(rules({}), r)), [1, 1, 1]);
  assert.deepEqual([0, 1, 5].map((r) => diceFor(rules({ dice: 3 }), r)), [3, 3, 3]);
  assert.deepEqual([0, 1, 2, 5, 6, 9].map((r) => diceFor(rules({ grow: true }), r)), [1, 2, 3, 6, 6, 6]);
  assert.deepEqual([0, 1, 4].map((r) => diceFor(rules({ dice: 4, grow: true }), r)), [4, 5, 6]);
  assert.equal(manyDice(rules({})), false);
  assert.equal(manyDice(rules({ dice: 2 })), true);
  assert.equal(manyDice(rules({ grow: true })), true);
});

test("начало партии: пустой ход у первого места", async () => {
  const state = await setup(["a", "b", "c"]);
  assert.equal(pig.currentSeat(state), "a");
  assert.deepEqual(state.turn, { rolls: [], points: 0 });
  assert.deepEqual(state.scores, { a: 0, b: 0, c: 0 });
  assert.deepEqual(pig.legalActions(state, "a"), [roll]);
  assert.deepEqual(pig.legalActions(state, "b"), []);
  assert.equal(pig.result(state), null);
});

// ---------- ход ----------

test("броски копят очки хода, запись кладёт их в счёт и передаёт ход", async () => {
  let { state, events } = await rolls(await setup(), [4, 6, 3]);
  assert.deepEqual(types(events), ["rolled", "rolled", "rolled"]);
  assert.deepEqual(events[1], { type: "rolled", seat: "a", values: [6] });
  assert.deepEqual(state.turn, { rolls: [[4], [6], [3]], points: 13 });
  assert.equal(state.current, "a");
  assert.deepEqual(pig.legalActions(state, "a"), [roll, hold]);

  ({ state, events } = await pig.apply(state, "a", hold, makeScriptedCtx([])));
  assert.deepEqual(events, [{ type: "held", seat: "a", points: 13, total: 13 }]);
  assert.equal(state.scores.a, 13);
  assert.equal(state.current, "b");
  assert.deepEqual(state.turn, { rolls: [], points: 0 });
});

test("единица: очки хода сгорают, счёт цел, ход переходит", async () => {
  let state = await setup();
  ({ state } = await rolls(state, [5, 5]));
  ({ state } = await pig.apply(state, "a", hold, makeScriptedCtx([])));
  ({ state } = await rolls(state, [2, 2]));
  ({ state } = await pig.apply(state, "b", hold, makeScriptedCtx([])));

  let events;
  ({ state, events } = await rolls(state, [6, 4, 1]));
  assert.deepEqual(events.slice(-2), [
    { type: "rolled", seat: "a", values: [1] },
    { type: "bust", seat: "a", lost: 10, rolls: [[6], [4], [1]] },
  ]);
  assert.deepEqual(state.scores, { a: 10, b: 4 });
  assert.equal(state.current, "b");
  assert.deepEqual(state.turn, { rolls: [], points: 0 });
});

test("единица первым же броском — сгорает ноль", async () => {
  const { state, events } = await rolls(await setup(), [1]);
  assert.deepEqual(events, [
    { type: "rolled", seat: "a", values: [1] },
    { type: "bust", seat: "a", lost: 0, rolls: [[1]] },
  ]);
  assert.equal(state.current, "b");
});

test("ход идёт по кругу", async () => {
  let state = await setup(["a", "b", "c"]);
  const seen = [];
  for (let i = 0; i < 4; i++) {
    seen.push(state.current);
    ({ state } = await rolls(state, [1]));
  }
  assert.deepEqual(seen, ["a", "b", "c", "a"]);
});

// ---------- несколько кубиков ----------

test("несколько кубиков: очки — сумма, хоть одна единица сжигает ход", async () => {
  let state = await setup(["a", "b"], { dice: 3 });
  let events;
  ({ state, events } = await rolls(state, [[6, 5, 2], [4, 4, 3]]));
  assert.deepEqual(events[0], { type: "rolled", seat: "a", values: [6, 5, 2] });
  assert.deepEqual(state.turn, { rolls: [[6, 5, 2], [4, 4, 3]], points: 24 });
  ({ state, events } = await rolls(state, [[6, 1, 6]]));
  assert.deepEqual(events.at(-1), { type: "bust", seat: "a", lost: 24, rolls: [[6, 5, 2], [4, 4, 3], [6, 1, 6]] });
  assert.equal(state.current, "b");
  // кубиков в броске всегда три: другое число — ошибка сценария
  await assert.rejects(pig.apply(state, "b", roll, makeScriptedCtx([[6]])));
});

test("на кубик больше с каждым броском — до шести, новый ход снова с начала", async () => {
  let state = await setup(["a", "b"], { dice: 2, grow: true, target: 500 });
  ({ state } = await rolls(state, [[2, 2], [3, 3, 3], [4, 4, 4, 4], [5, 5, 5, 5, 5], [6, 6, 6, 6, 6, 6], [2, 2, 2, 2, 2, 2]]));
  assert.deepEqual(state.turn.rolls.map((r) => r.length), [2, 3, 4, 5, 6, 6]);
  assert.equal(state.turn.points, 4 + 9 + 16 + 25 + 36 + 12);
  ({ state } = await pig.apply(state, "a", hold, makeScriptedCtx([])));
  ({ state } = await rolls(state, [[3, 3], [1, 2, 3]]));
  assert.equal(state.current, "a");
  ({ state } = await rolls(state, [[5, 5]]));
  assert.deepEqual(state.turn.rolls, [[5, 5]]);
});

test("растущий бросок: записать можно после любого броска, новый ход — снова с начала", async () => {
  for (let stop = 1; stop <= 6; stop++) {
    let state = await setup(["a", "b"], { grow: true, target: 500 });
    const throws = [[3], [4, 4], [5, 5, 5], [2, 2, 2, 2], [6, 6, 6, 6, 6], [3, 3, 3, 3, 3, 3]].slice(0, stop);
    ({ state } = await rolls(state, throws));
    assert.equal(pig.validate(state, "a", hold), null, `после ${stop}-го броска`);
    let events;
    ({ state, events } = await pig.apply(state, "a", hold, makeScriptedCtx([])));
    const points = throws.flat().reduce((x, v) => x + v, 0);
    assert.deepEqual(events, [{ type: "held", seat: "a", points, total: points }]);
    // у следующего игрока и у самого a следующий ход начинается с одного кубика
    ({ state } = await rolls(state, [[5]]));
    assert.deepEqual(state.turn.rolls, [[5]]);
    ({ state } = await pig.apply(state, "b", hold, makeScriptedCtx([])));
    ({ state } = await rolls(state, [[4]]));
    assert.deepEqual(state.turn.rolls, [[4]]);
  }
});

test("две единицы при настройке сжигают и весь счёт", async () => {
  let state = await setup(["a", "b"], { dice: 3, snakeEyes: true });
  ({ state } = await rolls(state, [[6, 6, 5]]));
  ({ state } = await pig.apply(state, "a", hold, makeScriptedCtx([])));
  ({ state } = await rolls(state, [[2, 2, 2]]));
  ({ state } = await pig.apply(state, "b", hold, makeScriptedCtx([])));
  assert.deepEqual(state.scores, { a: 17, b: 6 });

  let events;
  ({ state, events } = await rolls(state, [[4, 4, 4], [1, 6, 1]]));
  assert.deepEqual(events.at(-1), { type: "bust", seat: "a", lost: 12, rolls: [[4, 4, 4], [1, 6, 1]], wiped: 17 });
  assert.deepEqual(state.scores, { a: 0, b: 6 });

  // одна единица — только ход; три — тоже весь счёт
  ({ state, events } = await rolls(state, [[1, 5, 5]]));
  assert.equal(events.at(-1).wiped, undefined);
  assert.equal(state.scores.b, 6);
  ({ state, events } = await rolls(state, [[1, 1, 1]]));
  assert.deepEqual(events.at(-1), { type: "bust", seat: "a", lost: 0, rolls: [[1, 1, 1]], wiped: 0 });
});

test("две единицы без настройки — сгорает только ход", async () => {
  let state = await setup(["a", "b"], { dice: 2 });
  ({ state } = await rolls(state, [[6, 6]]));
  ({ state } = await pig.apply(state, "a", hold, makeScriptedCtx([])));
  ({ state } = await rolls(state, [[1, 3]]));
  let events;
  ({ state, events } = await rolls(state, [[1, 1]]));
  assert.equal(events.at(-1).wiped, undefined);
  assert.equal(state.scores.a, 12);
});

// ---------- предел ходов ----------

/** Сыграть ход: записать после бросков или сгореть. */
async function playTurn(state, throws, then = "hold") {
  ({ state } = await rolls(state, throws));
  if (then === "hold") ({ state } = await pig.apply(state, state.current, hold, makeScriptedCtx([])));
  return state;
}

test("предел ходов: когда все сыграли, побеждает больший счёт", async () => {
  let state = await setup(["a", "b", "c"], { maxTurns: 2 });
  state = await playTurn(state, [6, 6]); // a: 12
  state = await playTurn(state, [5]); // b: 5
  state = await playTurn(state, [1], "bust"); // c: 0, ход засчитан
  assert.deepEqual(state.turns, { a: 1, b: 1, c: 1 });
  state = await playTurn(state, [2]); // a: 14
  state = await playTurn(state, [6, 6, 4]); // b: 21
  assert.equal(state.finished, false);
  let events;
  ({ state, events } = await rolls(state, [3, 3]));
  ({ state, events } = await pig.apply(state, "c", hold, makeScriptedCtx([])));
  assert.deepEqual(events, [
    { type: "held", seat: "c", points: 6, total: 6 },
    { type: "won", seat: "b", total: 21, byLimit: true },
  ]);
  assert.equal(state.byLimit, true);
  assert.equal(pig.currentSeat(state), null);
  assert.deepEqual(pig.result(state), { winners: ["b"], scores: { a: 14, b: 21, c: 6 } });
});

test("предел ходов: равный счёт — победителей несколько", async () => {
  let state = await setup(["a", "b"], { maxTurns: 1 });
  state = await playTurn(state, [4, 4]);
  let events;
  ({ state, events } = await rolls(state, [6, 2]));
  ({ state, events } = await pig.apply(state, "b", hold, makeScriptedCtx([])));
  assert.deepEqual(events.slice(1), [
    { type: "won", seat: "a", total: 8, byLimit: true },
    { type: "won", seat: "b", total: 8, byLimit: true },
  ]);
  assert.deepEqual(pig.result(state).winners, ["a", "b"]);
});

test("предел ходов: цель, набранная раньше, побеждает как обычно", async () => {
  let state = await setup(["a", "b"], { maxTurns: 5, target: 50 });
  let events;
  ({ state, events } = await rolls(state, [6, 6, 6, 6, 6, 6, 6, 6, 6]));
  assert.deepEqual(events.at(-1), { type: "won", seat: "a", total: 54 });
  assert.equal(state.byLimit, false);
});

test("предел ходов: ушёл последний недоигравший — партия кончается", async () => {
  let state = await setup(["a", "b", "c"], { maxTurns: 1 });
  state = await playTurn(state, [5]);
  state = await playTurn(state, [6]);
  let events;
  ({ state, events } = await pig.removeSeat(state, "c", makeScriptedCtx([])));
  assert.deepEqual(events, [{ type: "left", seat: "c" }, { type: "won", seat: "b", total: 6, byLimit: true }]);
  assert.deepEqual(pig.result(state), { winners: ["b"], scores: { a: 5, b: 6 } });
});

test("предел ходов 0 — без предела", async () => {
  let state = await setup(["a", "b"]);
  for (let i = 0; i < 30; i++) state = await playTurn(state, [2]);
  assert.equal(state.finished, false);
  assert.deepEqual(state.turns, { a: 15, b: 15 });
});

// ---------- победа ----------

test("набрал цель — победа сразу, без записи", async () => {
  let state = await setup(["a", "b"], { target: 50 });
  ({ state } = await rolls(state, [6, 6, 6, 6, 6, 6, 6]));
  ({ state } = await pig.apply(state, "a", hold, makeScriptedCtx([])));
  assert.equal(state.scores.a, 42);
  ({ state } = await rolls(state, [3]));
  ({ state } = await pig.apply(state, "b", hold, makeScriptedCtx([])));

  let events;
  ({ state, events } = await rolls(state, [5, 4]));
  assert.deepEqual(events.slice(-3), [
    { type: "rolled", seat: "a", values: [4] },
    { type: "held", seat: "a", points: 9, total: 51 },
    { type: "won", seat: "a", total: 51 },
  ]);
  assert.equal(state.finished, true);
  assert.equal(pig.currentSeat(state), null);
  assert.deepEqual(state.turn, { rolls: [[5], [4]], points: 9 });
  assert.deepEqual(pig.result(state), { winners: ["a"], scores: { a: 51, b: 3 } });
  assert.deepEqual(pig.legalActions(state, "b"), []);
});

test("ровно цель — тоже победа", async () => {
  let state = await setup(["a", "b"], { target: 50 });
  ({ state } = await rolls(state, [6, 6, 6, 6, 6, 6, 6, 6]));
  assert.equal(state.finished, false);
  let events;
  ({ state, events } = await rolls(state, [2]));
  assert.deepEqual(events.at(-1), { type: "won", seat: "a", total: 50 });
});

test("validate: коды ошибок", async () => {
  const fresh = await setup();
  assert.equal(pig.validate(fresh, "b", roll), "notYourTurn");
  assert.equal(pig.validate(fresh, "a", hold), "mustRoll");
  assert.equal(pig.validate(fresh, "a", { type: "keep" }), "badAction");
  assert.equal(pig.validate(fresh, "a", null), "badAction");
  assert.equal(pig.validate(fresh, "a", roll), null);
  await assert.rejects(runAction(pig, fresh, "a", hold, makeScriptedCtx([])), (err) => err instanceof GameError && err.code === "mustRoll");

  const { state } = await rolls(fresh, [3]);
  assert.equal(pig.validate(state, "a", hold), null);

  let { state: done } = await rolls(await setup(["a", "b"], { target: 50 }), [6, 6, 6, 6, 6, 6, 6, 6, 6]);
  assert.equal(done.finished, true);
  assert.equal(pig.validate(done, "b", roll), "finished");
});

test("apply и removeSeat не меняют входное состояние", async () => {
  const { state } = await rolls(await setup(["a", "b", "c"], { dice: 2, snakeEyes: true }), [[4, 5]]);
  const before = JSON.stringify(state);
  await pig.apply(state, "a", roll, makeScriptedCtx([[6, 6]]));
  await pig.apply(state, "a", roll, makeScriptedCtx([[1, 1]]));
  await pig.apply(state, "a", hold, makeScriptedCtx([]));
  await pig.removeSeat(state, "a", makeScriptedCtx([]));
  assert.equal(JSON.stringify(state), before);
});

// ---------- уход из-за стола ----------

test("ушедший игрок: остался один — он и выиграл", async () => {
  let state = await setup();
  let events;
  ({ state, events } = await pig.removeSeat(state, "a", makeScriptedCtx([])));
  assert.deepEqual(events, [{ type: "left", seat: "a" }, { type: "won", seat: "b", total: 0 }]);
  assert.deepEqual(pig.result(state), { winners: ["b"], scores: { b: 0 } });
});

test("ушёл текущий — следующий начинает ход заново", async () => {
  let { state } = await rolls(await setup(["a", "b", "c"]), [4, 5]);
  let events;
  ({ state, events } = await pig.removeSeat(state, "a", makeScriptedCtx([])));
  assert.deepEqual(events, [{ type: "left", seat: "a" }]);
  assert.equal(state.current, "b");
  assert.deepEqual(state.order, ["b", "c"]);
  assert.deepEqual(state.scores, { b: 0, c: 0 });
  assert.deepEqual(state.turn, { rolls: [], points: 0 });
});

test("ушёл текущий в конце круга — ход у первого", async () => {
  let { state } = await rolls(await setup(["a", "b", "c"]), [1, 1]);
  assert.equal(state.current, "c");
  ({ state } = await pig.removeSeat(state, "c", makeScriptedCtx([])));
  assert.equal(state.current, "a");
});

test("ушёл не текущий — ход и очки хода остаются", async () => {
  let { state } = await rolls(await setup(["a", "b", "c"]), [4, 5]);
  ({ state } = await pig.removeSeat(state, "b", makeScriptedCtx([])));
  assert.equal(state.current, "a");
  assert.deepEqual(state.turn, { rolls: [[4], [5]], points: 9 });
  ({ state } = await pig.apply(state, "a", hold, makeScriptedCtx([])));
  assert.equal(state.current, "c");
});

test("уход постороннего или после конца партии ничего не меняет", async () => {
  let state = await setup(["a", "b", "c"]);
  const before = structuredClone(state);
  ({ state } = await pig.removeSeat(state, "zzz", makeScriptedCtx([])));
  assert.deepEqual(state, before);

  let { state: done } = await rolls(await setup(["a", "b"], { target: 50 }), [6, 6, 6, 6, 6, 6, 6, 6, 6]);
  const after = (await pig.removeSeat(done, "b", makeScriptedCtx([]))).state;
  assert.deepEqual(after, done);
});

// ---------- бот ----------

/** rng по умолчанию всегда 0 — бот не ошибается. */
const decide = (state, seatId, temp = "counter", rng = () => 0) =>
  bot({ view: structuredClone(state), mine: null, seatId, options: state.rules, temperament: temperament(temp), rng });

async function withScores(scores, turnRolls, options = {}) {
  const ids = Object.keys(scores);
  const state = await setup(ids, options);
  state.scores = { ...scores };
  return (await rolls(state, turnRolls)).state;
}

test("breakEven: один кубик — 20, с каждым кубиком меньше, две единицы снижают ещё", () => {
  assert.ok(Math.abs(breakEven(1, 0, false) - 20) < 1e-9);
  for (let n = 2; n <= 6; n++) assert.ok(breakEven(n, 0, false) < breakEven(n - 1, 0, false));
  assert.ok(Math.abs(breakEven(1, 80, true) - breakEven(1, 0, false)) < 1e-9);
  assert.ok(breakEven(2, 60, true) < breakEven(2, 0, true));
});

test("бот: в начале хода всегда бросает", async () => {
  for (const options of [{}, { dice: 6, snakeEyes: true }]) {
    const state = await setup(["a", "b"], options);
    for (const temp of TEMPERAMENT_IDS) {
      for (let seed = 1; seed <= 30; seed++) assert.deepEqual(decide(state, "a", temp, mulberry32(seed)), roll);
    }
  }
});

test("бот: при равном счёте записывает с 21 очка хода", async () => {
  assert.deepEqual(decide(await withScores({ a: 30, b: 30 }, [6, 6, 6, 2]), "a"), roll);
  assert.deepEqual(decide(await withScores({ a: 30, b: 30 }, [6, 6, 6, 3]), "a"), hold);
});

test("бот: отстающий тянет дольше, лидер записывает раньше", async () => {
  // отстаёт на 40 — порог 26; ведёт на 40 — порог 16
  assert.deepEqual(decide(await withScores({ a: 10, b: 50 }, [6, 6, 6, 4]), "a"), roll);
  assert.deepEqual(decide(await withScores({ a: 50, b: 10 }, [6, 6, 4]), "a"), hold);
});

test("бот: кто-то у самой цели — бросает до победы", async () => {
  // соперник на 75: 30 очков хода не повод останавливаться
  assert.deepEqual(decide(await withScores({ a: 20, b: 75 }, [6, 6, 6, 6, 6]), "a"), roll);
  // сам на 72 и ведёт: тоже до победы
  assert.deepEqual(decide(await withScores({ a: 72, b: 10 }, [6, 6, 6, 6]), "a"), roll);
});

test("бот: «у цели» — это полтора хода, а не доля цели", async () => {
  // игра до 300: соперник в 25 очках от цели — гонка; в 60 — нет
  assert.deepEqual(decide(await withScores({ a: 100, b: 275 }, [6, 6, 6, 6, 6], { target: 300 }), "a"), roll);
  assert.deepEqual(decide(await withScores({ a: 100, b: 240 }, [6, 6, 6, 6, 6], { target: 300 }), "a"), hold);
});

test("бот: осторожный записывает раньше безрассудного", async () => {
  const state = await withScores({ a: 30, b: 30 }, [6, 6, 4]);
  assert.deepEqual(decide(state, "a", "cautious"), hold);
  assert.deepEqual(decide(state, "a", "reckless"), roll);
});

test("бот: больше кубиков в броске — останавливается раньше", async () => {
  // 18 очков: с одним кубиком — бросать дальше, с тремя — записать
  assert.deepEqual(decide(await withScores({ a: 30, b: 30 }, [6, 6, 6]), "a"), roll);
  assert.deepEqual(decide(await withScores({ a: 30, b: 30 }, [[6, 6, 6]], { dice: 3 }), "a"), hold);
  // растущий бросок: следующий — три кубика
  assert.deepEqual(decide(await withScores({ a: 30, b: 30 }, [[6], [6, 6]], { grow: true }), "a"), hold);
});

test("бот: когда две единицы сжигают счёт, бережёт записанное", async () => {
  const turn = [[6, 6], [3, 2]]; // 17 очков хода
  assert.deepEqual(decide(await withScores({ a: 60, b: 60 }, turn, { dice: 2 }), "a"), roll);
  assert.deepEqual(decide(await withScores({ a: 60, b: 60 }, turn, { dice: 2, snakeEyes: true }), "a"), hold);
  // сам у цели: без угрозы счёту — до победы, с угрозой — записывает
  assert.deepEqual(decide(await withScores({ a: 75, b: 10 }, [[6, 6]], { dice: 2 }), "a"), roll);
  assert.deepEqual(decide(await withScores({ a: 75, b: 10 }, [[6, 6]], { dice: 2, snakeEyes: true }), "a"), hold);
});

test("длина партии: правдоподобна и растёт с целью, «две единицы» на большой цели — без конца", () => {
  const est = (o, seats = 3) => estimateTurns(pig.normalizeOptions(o), seats);
  const classic = est({ target: 100 }, 2);
  assert.ok(classic.median >= 8 && classic.median <= 13, JSON.stringify(classic));
  assert.ok(classic.long > classic.median);
  // больше игроков — кто-то дойдёт раньше
  assert.ok(est({ target: 100 }, 6).median <= classic.median);
  assert.ok(est({ target: 200 }).median > est({ target: 100 }).median);
  // две единицы затягивают
  assert.ok(est({ target: 100, dice: 6, snakeEyes: true }).long > est({ target: 100, dice: 6 }).long);
  assert.deepEqual(est({ target: 500, dice: 6, snakeEyes: true }), { median: null, long: null });
});

test("бот: последний ход перед пределом — тянет, пока не обгонит лидера", async () => {
  // a отстаёт на 40, сейчас его последний ход: 30 очков хода мало, 41 — хватит
  const last = async (turn) => {
    const state = await withScores({ a: 20, b: 60 }, turn, { maxTurns: 3 });
    state.turns = { a: 2, b: 3 };
    return decide(state, "a");
  };
  assert.deepEqual(await last([6, 6, 6, 6, 6]), roll);
  assert.deepEqual(await last([6, 6, 6, 6, 6, 6, 5]), hold);
  // не последний ход — обычный порог
  const early = await withScores({ a: 20, b: 60 }, [6, 6, 6, 6, 6], { maxTurns: 3 });
  assert.deepEqual(decide(early, "a"), hold);
});

// В «Свинье» много удачи: даже лучшая игра даёт перевес в несколько процентов, поэтому партий много.
test("расчётливый бот обыгрывает простодушного", async () => {
  let wins = 0;
  const games = 2000;
  for (let seed = 1; seed <= games; seed++) {
    const rng = mulberry32(seed);
    const local = { rng, roll: async () => [[1 + Math.floor(rng() * 6)]] };
    const order = seed % 2 ? ["smart", "dumb"] : ["dumb", "smart"];
    const temps = { smart: temperament("counter"), dumb: temperament("simple") };
    let state = await setup(order);
    while (!state.finished) {
      const id = state.current;
      const action = bot({ view: state, mine: null, seatId: id, options: state.rules, temperament: temps[id], rng });
      ({ state } = await pig.apply(state, id, action, local));
    }
    if (state.winners.includes("smart")) wins++;
  }
  assert.ok(wins / games > 0.5, `расчётливый выиграл ${wins} из ${games}`);
});

test("боты доигрывают 3000 партий без недопустимых ходов", async () => {
  // «Две единицы — весь счёт» с большой целью тянется бесконечно, поэтому с ней — только короткие партии.
  const variants = [
    { target: 100 },
    { target: 50, dice: 2 },
    { target: 150, dice: 6 },
    { target: 200, grow: true },
    { target: 300, dice: 3, grow: true },
    { target: 100, dice: 2, snakeEyes: true },
    { target: 50, dice: 4, snakeEyes: true },
    { target: 100, grow: true, snakeEyes: true },
    { target: 100, maxTurns: 3 },
    { target: 500, dice: 6, snakeEyes: true, maxTurns: 12 },
  ];
  const seen = { bust: 0, held: 0, burned: 0, wiped: 0, limit: 0 };
  for (let seed = 1; seed <= 3000; seed++) {
    const options = variants[seed % variants.length];
    const { state, result, events, seatIds } = await simulate(pig, bot, {
      seats: 2 + (seed % 5),
      seed,
      options,
      onStep({ state: s, seatId, action, events: evs }) {
        assert.ok(evs.length > 0);
        assert.ok(evs.every((e) => e.seat === seatId || (e.type === "won" && e.byLimit)));
        assert.equal(evs[0].type, action.type === "roll" ? "rolled" : "held");
        const bust = evs.find((e) => e.type === "bust");
        if (bust) bust.rolls.forEach((r, i) => assert.equal(r.length, diceFor(s.rules, i)));
        if (!s.finished) {
          assert.ok(s.order.includes(s.current));
          assert.equal(s.turn.points, s.turn.rolls.flat().reduce((a, v) => a + v, 0));
          assert.ok(!s.turn.rolls.flat().includes(1));
          s.turn.rolls.forEach((r, i) => assert.equal(r.length, diceFor(s.rules, i)));
        }
      },
    });
    const top = Math.max(...Object.values(result.scores));
    if (state.byLimit) {
      // все сыграли предел, победили все с наибольшим счётом
      assert.ok(state.order.every((id) => state.turns[id] === state.rules.maxTurns), `seed ${seed}`);
      assert.deepEqual(result.winners, state.order.filter((id) => result.scores[id] === top));
    } else {
      assert.equal(result.winners.length, 1, `seed ${seed}`);
      assert.ok(result.scores[result.winners[0]] >= state.rules.target);
      if (state.rules.maxTurns) assert.ok(state.order.every((id) => state.turns[id] <= state.rules.maxTurns));
    }
    for (const id of seatIds) {
      if (!result.winners.includes(id)) assert.ok(result.scores[id] < state.rules.target);
      // счёт — записанное после последнего «весь счёт сгорел»
      const mine = events.filter((e) => e.seat === id);
      const lastWipe = mine.findLastIndex((e) => e.type === "bust" && e.wiped !== undefined);
      const held = mine.slice(lastWipe + 1).filter((e) => e.type === "held");
      assert.equal(held.reduce((a, e) => a + e.points, 0), result.scores[id]);
      assert.ok(held.every((e) => e.points > 0));
    }
    const won = events.filter((e) => e.type === "won");
    assert.deepEqual(won.map((e) => e.seat), result.winners);
    assert.ok(won.every((e) => e.total === result.scores[e.seat] && Boolean(e.byLimit) === state.byLimit));
    seen.limit += state.byLimit ? 1 : 0;
    seen.bust += events.filter((e) => e.type === "bust").length;
    seen.burned += events.filter((e) => e.type === "bust" && e.lost > 0).length;
    seen.wiped += events.filter((e) => e.type === "bust" && e.wiped > 0).length;
    seen.held += events.filter((e) => e.type === "held").length;
  }
  assert.ok(seen.bust > 0 && seen.burned > 0 && seen.held > 0 && seen.wiped > 0 && seen.limit > 0);
});
