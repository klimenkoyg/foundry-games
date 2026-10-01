import assert from "node:assert/strict";
import { test } from "node:test";

import bot from "../scripts/core/bots/tw.mjs";
import { makeScriptedCtx } from "../scripts/core/engine.mjs";
import tw, { DICE, bustChance } from "../scripts/core/games/tw.mjs";
import { simulate } from "./helpers/sim.mjs";

const NO_DICE = makeScriptedCtx([]);
const STAND = { type: "stand" };
const PASS = { type: "pass" };
const take = (sides) => ({ type: "take", sides });

const setup = (seatIds = ["a", "b"], options = {}) =>
  tw.setup({ seatIds, options: tw.normalizeOptions(options), ctx: NO_DICE });

/** Проверяет и применяет ходы одного места подряд; возвращает состояние и все события. */
async function play(state, ctx, seatId, ...actions) {
  const events = [];
  for (const action of actions) {
    assert.equal(tw.validate(state, seatId, action), null, `${seatId}: ${JSON.stringify(action)}`);
    const res = await tw.apply(state, seatId, action, ctx);
    state = res.state;
    events.push(...res.events);
  }
  return { state, events };
}

test("bustChance: доля граней, уводящих за предел", () => {
  assert.equal(bustChance(15, 6, 21), 0);
  assert.equal(bustChance(18, 6, 21), 0.5);
  assert.equal(bustChance(21, 4, 21), 1);
  assert.equal(bustChance(0, 20, 21), 0);
  assert.equal(bustChance(30, 4, 21), 1);
  assert.equal(bustChance(12, 20, 21), 11 / 20);
  assert.deepEqual(DICE, [4, 6, 8, 10, 12, 20]);
});

test("настройки: значения по умолчанию и границы", () => {
  assert.deepEqual(tw.normalizeOptions({}), { limit: 21, wins: 3, fewerDice: true });
  assert.deepEqual(tw.normalizeOptions({ limit: 99, wins: 0, fewerDice: false }), { limit: 31, wins: 1, fewerDice: false });
  assert.deepEqual(tw.normalizeOptions({ limit: 3, wins: 9 }), { limit: 15, wins: 5, fewerDice: true });
});

test("начало партии: первый круг открывает order[0]", async () => {
  const state = await setup(["a", "b", "c"], { limit: 25, wins: 2 });
  assert.deepEqual(state.order, ["a", "b", "c"]);
  assert.deepEqual(state.rules, { limit: 25, wins: 2, fewerDice: true });
  assert.deepEqual(state.wins, { a: 0, b: 0, c: 0 });
  assert.equal(state.round, 1);
  assert.equal(state.firstSeat, "a");
  assert.equal(state.current, "a");
  assert.deepEqual(state.hands.b, { rolled: [], total: 0, stood: false, bust: false, done: false });
  assert.equal(state.lastRound, null);
  assert.equal(state.winner, null);
  assert.equal(state.finished, false);
  assert.equal(tw.currentSeat(state), "a");
  assert.equal(tw.result(state), null);
  assert.equal(tw.privateView(state, "a"), null);
  assert.equal(tw.publicView(state), state);
});

test("взятие прибавляет бросок, ход остаётся у того же места", async () => {
  const start = await setup();
  const before = JSON.stringify(start);
  const { state, events } = await play(start, makeScriptedCtx([[7], [3]]), "a", take(20), take(6));
  assert.equal(JSON.stringify(start), before);
  assert.deepEqual(state.hands.a.rolled, [{ sides: 20, value: 7 }, { sides: 6, value: 3 }]);
  assert.equal(state.hands.a.total, 10);
  assert.equal(state.hands.a.done, false);
  assert.equal(state.current, "a");
  assert.deepEqual(events, [
    { type: "took", seat: "a", sides: 20, value: 7, total: 7, bust: false, done: false },
    { type: "took", seat: "a", sides: 6, value: 3, total: 10, bust: false, done: false },
  ]);
});

test("перебор: рука сгорела, ход переходит", async () => {
  const start = await setup();
  const { state, events } = await play(start, makeScriptedCtx([[18], [4]]), "a", take(20), take(4));
  assert.deepEqual(
    { total: state.hands.a.total, bust: state.hands.a.bust, stood: state.hands.a.stood, done: state.hands.a.done },
    { total: 22, bust: true, stood: false, done: true },
  );
  assert.equal(state.current, "b");
  assert.deepEqual(events.at(-1), { type: "took", seat: "a", sides: 4, value: 4, total: 22, bust: true, done: true });
});

test("ровно предел — не перебор", async () => {
  const { state } = await play(await setup(), makeScriptedCtx([[17], [4]]), "a", take(20), take(4));
  assert.equal(state.hands.a.total, 21);
  assert.equal(state.hands.a.bust, false);
  assert.equal(state.hands.a.done, false);
  assert.equal(state.current, "a");
});

test("остановка: рука закрыта, ход переходит", async () => {
  const { state, events } = await play(await setup(), makeScriptedCtx([[16]]), "a", take(20), STAND);
  assert.deepEqual(
    { total: state.hands.a.total, bust: state.hands.a.bust, stood: state.hands.a.stood, done: state.hands.a.done },
    { total: 16, bust: false, stood: true, done: true },
  );
  assert.equal(state.current, "b");
  assert.deepEqual(events.at(-1), { type: "stood", seat: "a", total: 16 });
});

test("все шесть костей без перебора — рука закрывается сама", async () => {
  const ctx = makeScriptedCtx([[1], [2], [3], [1], [2], [5]]);
  const { state, events } = await play(await setup(), ctx, "a", ...DICE.map(take));
  assert.equal(state.hands.a.total, 14);
  assert.equal(state.hands.a.stood, true);
  assert.equal(state.hands.a.bust, false);
  assert.equal(state.hands.a.done, true);
  assert.equal(state.current, "b");
  assert.equal(events.at(-1).done, true);
  assert.equal(ctx.remaining(), 0);
});

test("круг берёт единственная лучшая сумма", async () => {
  const ctx = makeScriptedCtx([[18], [15]]);
  let state = await setup();
  ({ state } = await play(state, ctx, "a", take(20), STAND));
  const res = await play(state, ctx, "b", take(20), STAND);
  state = res.state;
  assert.deepEqual(res.events.at(-1), { type: "roundWon", seat: "a", totals: { a: 18, b: 15 }, busts: [], round: 1, byDice: false });
  assert.deepEqual(state.wins, { a: 1, b: 0 });
  assert.deepEqual(state.lastRound, { winner: "a", totals: { a: 18, b: 15 }, busts: [], round: 1, byDice: false });
  // новый круг: руки пустые, открывает следующий
  assert.equal(state.round, 2);
  assert.equal(state.firstSeat, "b");
  assert.equal(state.current, "b");
  assert.deepEqual(state.hands.a, { rolled: [], total: 0, stood: false, bust: false, done: false });
  assert.equal(tw.result(state), null);
});

test("перебор не выигрывает даже с большей суммой", async () => {
  const ctx = makeScriptedCtx([[20], [6], [3]]);
  let state = await setup();
  ({ state } = await play(state, ctx, "a", take(20), take(6)));
  const res = await play(state, ctx, "b", take(4), STAND);
  assert.deepEqual(res.events.at(-1), { type: "roundWon", seat: "b", totals: { a: 26, b: 3 }, busts: ["a"], round: 1, byDice: false });
  assert.deepEqual(res.state.wins, { a: 0, b: 1 });
});

test("равенство наверху — круг ничей", async () => {
  const ctx = makeScriptedCtx([[15], [15], [9]]);
  let state = await setup(["a", "b", "c"]);
  ({ state } = await play(state, ctx, "a", take(20), STAND));
  ({ state } = await play(state, ctx, "b", take(20), STAND));
  const res = await play(state, ctx, "c", take(12), STAND);
  state = res.state;
  assert.deepEqual(res.events.at(-1), {
    type: "roundWon",
    seat: null,
    totals: { a: 15, b: 15, c: 9 },
    busts: [],
    round: 1,
    byDice: false,
  });
  assert.deepEqual(state.wins, { a: 0, b: 0, c: 0 });
  assert.equal(state.lastRound.winner, null);
  assert.equal(state.round, 2);
});

test("перебор у всех — круг ничей", async () => {
  const ctx = makeScriptedCtx([[16], [20]]);
  let state = await setup(["a", "b"], { limit: 15 });
  ({ state } = await play(state, ctx, "a", take(20)));
  const res = await play(state, ctx, "b", take(20));
  state = res.state;
  assert.deepEqual(res.events.at(-1), { type: "roundWon", seat: null, totals: { a: 16, b: 20 }, busts: ["a", "b"], round: 1, byDice: false });
  assert.deepEqual(state.wins, { a: 0, b: 0 });
  assert.equal(state.round, 2);
  assert.equal(state.finished, false);
});

test("открывающий круг сдвигается, очередь идёт по кругу от него", async () => {
  let state = await setup(["a", "b", "c"]);
  const openers = [];
  const turns = [];
  for (let round = 1; round <= 4; round++) {
    openers.push(state.firstSeat);
    assert.equal(state.round, round);
    // все стоят на нуле — ничья, счёт не меняется
    for (let i = 0; i < 3; i++) {
      turns.push(state.current);
      ({ state } = await play(state, NO_DICE, state.current, STAND));
    }
  }
  assert.deepEqual(openers, ["a", "b", "c", "a"]);
  assert.deepEqual(turns, ["a", "b", "c", "b", "c", "a", "c", "a", "b", "a", "b", "c"]);
  assert.deepEqual(state.wins, { a: 0, b: 0, c: 0 });
});

test("партия заканчивается, когда кто-то набрал нужное число кругов", async () => {
  const ctx = makeScriptedCtx([[18], [10], [5], [19]]);
  let state = await setup(["a", "b"], { wins: 2 });
  ({ state } = await play(state, ctx, "a", take(20), STAND));
  ({ state } = await play(state, ctx, "b", take(20), STAND));
  assert.equal(state.finished, false);
  ({ state } = await play(state, ctx, "b", take(20), STAND));
  const res = await play(state, ctx, "a", take(20), STAND);
  state = res.state;
  assert.deepEqual(res.events.slice(-2), [
    { type: "roundWon", seat: "a", totals: { a: 19, b: 5 }, busts: [], round: 2, byDice: false },
    { type: "won", seat: "a" },
  ]);
  assert.equal(state.finished, true);
  assert.equal(state.winner, "a");
  assert.equal(state.current, null);
  assert.equal(state.round, 2);
  assert.equal(tw.currentSeat(state), null);
  assert.deepEqual(tw.result(state), { winners: ["a"], scores: { a: 2, b: 0 } });
  assert.deepEqual(tw.legalActions(state, "a"), []);
  assert.equal(tw.validate(state, "a", STAND), "finished");
  assert.equal(tw.validate(state, "b", take(4)), "finished");
});

test("одного круга хватает при wins = 1", async () => {
  let state = await setup(["a", "b"], { wins: 1 });
  ({ state } = await play(state, makeScriptedCtx([[2]]), "a", take(4), STAND));
  ({ state } = await play(state, NO_DICE, "b", STAND));
  assert.deepEqual(tw.result(state), { winners: ["a"], scores: { a: 1, b: 0 } });
});

test("коды ошибок", async () => {
  let state = await setup();
  assert.equal(tw.validate(state, "b", STAND), "notYourTurn");
  assert.equal(tw.validate(state, "b", take(6)), "notYourTurn");
  assert.equal(tw.validate(state, "a", { type: "roll" }), "badAction");
  assert.equal(tw.validate(state, "a", null), "badAction");
  assert.equal(tw.validate(state, "a", {}), "badAction");
  assert.equal(tw.validate(state, "a", take(7)), "badDie");
  assert.equal(tw.validate(state, "a", take("6")), "badDie");
  assert.equal(tw.validate(state, "a", { type: "take" }), "badDie");
  assert.equal(tw.validate(state, "a", take(6)), null);
  assert.equal(tw.validate(state, "a", STAND), null);
  ({ state } = await play(state, makeScriptedCtx([[2]]), "a", take(6)));
  assert.equal(tw.validate(state, "a", take(6)), "dieUsed");
  assert.equal(tw.validate(state, "a", take(8)), null);
});

test("допустимые ходы: невзятые кости, пас и — взяв кость — передать ход", async () => {
  let state = await setup();
  assert.deepEqual(tw.legalActions(state, "a"), [...DICE.map(take), STAND]);
  assert.deepEqual(tw.legalActions(state, "b"), []);
  ({ state } = await play(state, makeScriptedCtx([[1], [1]]), "a", take(8), take(20)));
  assert.deepEqual(tw.legalActions(state, "a"), [take(4), take(6), take(10), take(12), PASS, STAND]);
  for (const action of tw.legalActions(state, "a")) assert.equal(tw.validate(state, "a", action), null);
});

test("передать ход: берут по очереди, рука остаётся открытой", async () => {
  const ctx = makeScriptedCtx([[5], [7], [3], [6]]);
  let state = await setup();
  assert.equal(tw.validate(state, "a", PASS), "mustRoll");

  let events;
  ({ state, events } = await play(state, ctx, "a", take(20), PASS));
  assert.deepEqual(events.at(-1), { type: "passed", seat: "a", total: 5 });
  assert.equal(state.current, "b");
  assert.equal(state.took, 0);
  assert.equal(state.hands.a.done, false);
  assert.equal(state.round, 1);

  // можно взять несколько костей за ход
  assert.equal(tw.validate(state, "b", PASS), "mustRoll");
  ({ state } = await play(state, ctx, "b", take(12), take(4), PASS));
  assert.equal(state.hands.b.total, 10);
  assert.equal(state.current, "a");

  // ход вернулся: рука прежняя, взятые кости не вернулись
  assert.equal(state.hands.a.total, 5);
  assert.equal(tw.validate(state, "a", take(20)), "dieUsed");
  ({ state } = await play(state, ctx, "a", take(8), PASS));
  assert.equal(state.hands.a.total, 11);
  assert.equal(state.current, "b");
});

test("пас закрывает руку; круг кончается, когда спасовали все", async () => {
  const ctx = makeScriptedCtx([[5], [7], [9]]);
  let state = await setup();
  ({ state } = await play(state, ctx, "a", take(20), PASS));
  ({ state } = await play(state, ctx, "b", take(20), PASS));
  // a отказывается от хода — больше в этом круге не берёт
  ({ state } = await play(state, ctx, "a", STAND));
  assert.equal(state.hands.a.done, true);
  assert.equal(state.round, 1);
  assert.equal(state.current, "b");

  // b остался один: передавать ход некому, только брать или пасовать
  assert.equal(tw.validate(state, "b", PASS), "mustRoll");
  ({ state } = await play(state, ctx, "b", take(12)));
  assert.equal(tw.validate(state, "b", PASS), "badAction");
  assert.deepEqual(tw.legalActions(state, "b"), [take(4), take(6), take(8), take(10), STAND]);
  assert.equal(state.current, "b");

  const res = await play(state, ctx, "b", STAND);
  assert.deepEqual(res.events.at(-1), { type: "roundWon", seat: "b", totals: { a: 5, b: 16 }, busts: [], round: 1, byDice: false });
  assert.equal(res.state.round, 2);
  assert.equal(res.state.took, 0);
});

test("ход по кругу пропускает закрытые руки", async () => {
  const ctx = makeScriptedCtx([[2], [3], [20], [4]]);
  let state = await setup(["a", "b", "c"], { limit: 15 });
  ({ state } = await play(state, ctx, "a", take(4), PASS));
  ({ state } = await play(state, ctx, "b", STAND));
  ({ state } = await play(state, ctx, "c", take(6), PASS));
  assert.equal(state.current, "a");
  // перебор тоже закрывает руку и передаёт ход
  ({ state } = await play(state, ctx, "a", take(20)));
  assert.equal(state.hands.a.bust, true);
  assert.equal(state.current, "c");
  assert.equal(state.took, 0);
  ({ state } = await play(state, ctx, "c", take(4)));
  assert.equal(tw.validate(state, "c", PASS), "badAction");
});

test("ушедший игрок: остался один — он и выиграл", async () => {
  const start = await setup();
  const before = JSON.stringify(start);
  const { state, events } = await tw.removeSeat(start, "a", NO_DICE);
  assert.equal(JSON.stringify(start), before);
  assert.deepEqual(events, [{ type: "left", seat: "a" }, { type: "won", seat: "b" }]);
  assert.deepEqual(state.order, ["b"]);
  assert.equal(state.finished, true);
  assert.equal(state.current, null);
  assert.deepEqual(tw.result(state), { winners: ["b"], scores: { b: 0 } });
});

test("ушёл текущий и открывший — ход и роль открывшего переходят к следующему", async () => {
  let state = await setup(["a", "b", "c"]);
  let events;
  ({ state, events } = await tw.removeSeat(state, "a", NO_DICE));
  assert.deepEqual(events, [{ type: "left", seat: "a" }]);
  assert.deepEqual(state.order, ["b", "c"]);
  assert.equal(state.current, "b");
  assert.equal(state.firstSeat, "b");
  assert.equal(state.hands.a, undefined);
  assert.deepEqual(state.wins, { b: 0, c: 0 });
  assert.equal(state.round, 1);
});

test("ушёл не текущий — ход остаётся на месте", async () => {
  let state = await setup(["a", "b", "c"]);
  ({ state } = await play(state, makeScriptedCtx([[9]]), "a", take(20)));
  ({ state } = await tw.removeSeat(state, "c", NO_DICE));
  assert.equal(state.current, "a");
  assert.equal(state.firstSeat, "a");
  assert.equal(state.hands.a.total, 9);
  ({ state } = await play(state, NO_DICE, "a", STAND));
  assert.equal(state.current, "b");
});

test("ушёл текущий в середине круга — ход идёт дальше по кругу", async () => {
  let state = await setup(["a", "b", "c", "d"]);
  ({ state } = await play(state, NO_DICE, "a", STAND));
  ({ state } = await tw.removeSeat(state, "b", NO_DICE));
  assert.equal(state.current, "c");
  assert.deepEqual(state.order, ["a", "c", "d"]);
  assert.equal(state.round, 1);
});

test("ушёл последний незакрытый — круг подводится без него", async () => {
  const ctx = makeScriptedCtx([[12], [7]]);
  let state = await setup(["a", "b", "c"]);
  ({ state } = await play(state, ctx, "a", take(20), STAND));
  ({ state } = await play(state, ctx, "b", take(20), STAND));
  let events;
  ({ state, events } = await tw.removeSeat(state, "c", NO_DICE));
  assert.deepEqual(events, [
    { type: "left", seat: "c" },
    { type: "roundWon", seat: "a", totals: { a: 12, b: 7 }, busts: [], round: 1, byDice: false },
  ]);
  assert.deepEqual(state.wins, { a: 1, b: 0 });
  assert.equal(state.round, 2);
  assert.equal(state.firstSeat, "b");
  assert.equal(state.current, "b");
});

test("уход последнего незакрытого может закончить партию", async () => {
  const ctx = makeScriptedCtx([[12], [7]]);
  let state = await setup(["a", "b", "c"], { wins: 1 });
  ({ state } = await play(state, ctx, "a", take(20), STAND));
  ({ state } = await play(state, ctx, "b", take(20), STAND));
  let events;
  ({ state, events } = await tw.removeSeat(state, "c", NO_DICE));
  assert.deepEqual(events.map((e) => e.type), ["left", "roundWon", "won"]);
  assert.deepEqual(tw.result(state), { winners: ["a"], scores: { a: 1, b: 0 } });
});

test("ушёл открывший круг — очередь открывающих не ломается", async () => {
  let state = await setup(["a", "b", "c"]);
  ({ state } = await play(state, NO_DICE, "a", STAND));
  ({ state } = await tw.removeSeat(state, "a", NO_DICE));
  assert.equal(state.firstSeat, "b");
  assert.equal(state.current, "b");
  ({ state } = await play(state, NO_DICE, "b", STAND));
  assert.equal(state.current, "c");
  ({ state } = await play(state, NO_DICE, "c", STAND));
  assert.equal(state.round, 2);
  assert.equal(state.firstSeat, "c");
  assert.equal(state.current, "c");
  ({ state } = await play(state, NO_DICE, "c", STAND));
  ({ state } = await play(state, NO_DICE, "b", STAND));
  assert.equal(state.firstSeat, "b");
});

test("уход после конца партии и чужого места ничего не меняет", async () => {
  let state = await setup(["a", "b", "c"]);
  const ghost = await tw.removeSeat(state, "zzz", NO_DICE);
  assert.deepEqual(ghost.state, state);
  assert.deepEqual(ghost.events, [{ type: "left", seat: "zzz" }]);
  ({ state } = await tw.removeSeat(state, "a", NO_DICE));
  ({ state } = await tw.removeSeat(state, "b", NO_DICE));
  assert.equal(state.winner, "c");
  const after = await tw.removeSeat(state, "c", NO_DICE);
  assert.deepEqual(after.state, state);
  assert.deepEqual(after.events, [{ type: "left", seat: "c" }]);
});

/* Бот: нрав без ошибок (skill = 1), чтобы решения были предсказуемы. */

const hand = (rolled = [], extra = {}) => ({
  rolled: rolled.map(([sides, value]) => ({ sides, value })),
  total: rolled.reduce((a, [, value]) => a + value, 0),
  stood: false,
  bust: false,
  done: false,
  ...extra,
});
const closed = (rolled, extra = {}) => hand(rolled, { stood: true, done: true, ...extra });
const view = (hands, limit = 21, took = 0) => ({ order: Object.keys(hands), rules: { limit, wins: 3 }, took, hands });
const decide = (v, seatId, greed = 1) =>
  bot({ view: v, mine: null, seatId, options: {}, temperament: { greed, skill: 1, bluff: 0 }, rng: () => 0.5 });

test("бот: ходит последним — стоит, если уже впереди, иначе тянет самую безопасную", () => {
  assert.deepEqual(decide(view({ b: closed([[20, 15]]), a: hand([[20, 17]]) }), "a"), STAND);
  // 12 против 18: к4, к6, к8 без риска — берёт крупнейшую из них
  assert.deepEqual(decide(view({ b: closed([[20, 18]]), a: hand([[20, 12]]) }), "a"), take(8));
  // соперник сгорел — достаточно любой суммы больше нуля
  const burnt = closed([[20, 20], [12, 9]], { stood: false, bust: true });
  assert.deepEqual(decide(view({ b: burnt, a: hand() }), "a"), take(20));
  assert.deepEqual(decide(view({ b: burnt, a: hand([[20, 3]]) }), "a"), STAND);
  // равенство на пределе — не дарит круг перебором
  assert.deepEqual(decide(view({ b: closed([[20, 17], [4, 4]]), a: hand([[20, 20], [4, 1]]) }), "a"), STAND);
});

test("бот: пока за ним ходят — берёт крупнейшую кость в пределах терпимости", () => {
  assert.deepEqual(decide(view({ a: hand(), b: hand() }), "a"), take(20));
  // 17: к4 без риска, к6 — уже 1/3
  assert.deepEqual(decide(view({ a: hand([[20, 17]]), b: hand() }), "a"), take(4));
  assert.deepEqual(decide(view({ a: hand([[20, 19]]), b: hand() }), "a"), STAND);
  // жадный терпит больше риска
  assert.deepEqual(decide(view({ a: hand([[20, 17]]), b: hand() }), "a", 1.6), take(6));
  // отстаёт от закрытой руки — терпимость выше, а стоять нельзя совсем
  const chasing = { b: closed([[20, 20]]), a: hand([[20, 16]]), c: hand() };
  assert.deepEqual(decide(view(chasing), "a"), take(8));
  const desperate = { b: closed([[20, 20], [4, 1]]), a: hand([[20, 20]]), c: hand() };
  assert.deepEqual(decide(view(desperate), "a", 0.7), take(4));
});

test("бот: взял кость — передаёт ход; вторую подряд берёт, только догоняя", () => {
  // впереди или наравне — одна кость за ход
  assert.deepEqual(decide(view({ a: hand([[20, 9]]), b: hand([[20, 4]]) }, 21, 1), "a"), PASS);
  assert.deepEqual(decide(view({ a: hand([[20, 9]]), b: hand([[20, 9]]) }, 21, 1), "a"), PASS);
  // позади и есть кость с терпимым риском — тянет ещё
  assert.deepEqual(decide(view({ a: hand([[20, 9]]), b: hand([[20, 15]]) }, 21, 1), "a"), take(12));
  // позади, но брать слишком опасно — передаёт ход, а не пасует
  assert.deepEqual(decide(view({ a: hand([[20, 19]]), b: hand([[20, 20]]) }, 21, 1), "a"), PASS);
  // тот же расклад в начале хода: передать нельзя, пас — проигрыш, приходится тянуть
  assert.deepEqual(decide(view({ a: hand([[20, 19]]), b: hand([[20, 20]]) }, 21, 0), "a"), take(4));
  // соперники закрылись — передавать некому: обогнал и пасует
  assert.deepEqual(decide(view({ a: hand([[20, 17]]), b: closed([[20, 15]]) }, 21, 1), "a"), STAND);
});

test("боты доигрывают 2400 партий без недопустимых ходов", async () => {
  const limits = [15, 21, 31];
  const seen = new Set();
  for (let seed = 1; seed <= 2400; seed++) {
    const seats = 2 + (seed % 5);
    const options = { limit: limits[seed % 3], wins: 1 + (Math.floor(seed / 3) % 3) };
    seen.add(`${seats}/${options.limit}/${options.wins}`);
    const { state, result, seatIds } = await simulate(tw, bot, {
      seats,
      seed,
      options,
      onStep({ state: s }) {
        for (const id of s.order) {
          const h = s.hands[id];
          assert.equal(h.total, h.rolled.reduce((a, r) => a + r.value, 0));
          assert.equal(new Set(h.rolled.map((r) => r.sides)).size, h.rolled.length);
          assert.equal(h.bust, h.total > s.rules.limit);
          assert.equal(h.done, h.bust || h.stood);
        }
        if (!s.finished) assert.equal(s.hands[s.current].done, false);
      },
    });
    assert.equal(state.finished, true);
    assert.equal(result.winners.length, 1);
    assert.ok(seatIds.includes(result.winners[0]));
    assert.equal(result.scores[result.winners[0]], options.wins);
    for (const id of seatIds) assert.ok(result.scores[id] <= options.wins);
    assert.equal(Object.values(result.scores).filter((w) => w === options.wins).length, 1);
  }
  // все сочетания числа мест, предела и числа кругов встретились
  assert.equal(seen.size, 5 * 3 * 3);
});

test("равная сумма: круг берёт тот, кто взял меньше костей", async () => {
  // a: к20 → 15 (одна кость); b: к12 → 9 и к6 → 6 (две кости). Суммы равны — побеждает a.
  const ctx = makeScriptedCtx([[15], [9], [6]]);
  let state = await setup(["a", "b"]);
  ({ state } = await play(state, ctx, "a", take(20), STAND));
  const res = await play(state, ctx, "b", take(12), take(6), STAND);
  state = res.state;
  const ev = res.events.find((e) => e.type === "roundWon");
  assert.equal(ev.seat, "a");
  assert.equal(ev.byDice, true);
  assert.equal(state.wins.a, 1);
  assert.equal(state.lastRound.byDice, true);
});

test("равная сумма без настройки fewerDice — круг ничей", async () => {
  const ctx = makeScriptedCtx([[15], [9], [6]]);
  let state = await setup(["a", "b"], { fewerDice: false });
  ({ state } = await play(state, ctx, "a", take(20), STAND));
  const res = await play(state, ctx, "b", take(12), take(6), STAND);
  assert.equal(res.events.find((e) => e.type === "roundWon").seat, null);
  assert.deepEqual(res.state.wins, { a: 0, b: 0 });
});
