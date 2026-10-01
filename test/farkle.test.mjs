import assert from "node:assert/strict";
import { test } from "node:test";

import bot from "../scripts/core/bots/farkle.mjs";
import { GameError, makeScriptedCtx, runAction } from "../scripts/core/engine.mjs";
import farkle, { hasScore, scoreSelection, scoringSelections } from "../scripts/core/games/farkle.mjs";
import { TEMPERAMENT_IDS, temperament } from "../scripts/core/temperaments.mjs";
import { mulberry32, subsets } from "../scripts/core/util.mjs";
import { simulate } from "./helpers/sim.mjs";

const rules = (over = {}) => farkle.normalizeOptions(over);

const setup = (seatIds = ["a", "b"], options = {}) =>
  farkle.setup({ seatIds, options: farkle.normalizeOptions(options), ctx: makeScriptedCtx([]) });

const roll = { type: "roll" };
const keep = (indices, then) => ({ type: "keep", indices, then });
const types = (events) => events.map((e) => e.type);

/** Доводит партию до состояния «на сукне лежит dice» у первого места. */
async function withDice(dice, options = {}, seatIds = ["a", "b"]) {
  const state = await setup(seatIds, options);
  return (await farkle.apply(state, seatIds[0], roll, makeScriptedCtx([dice]))).state;
}

// ---------- очки ----------

test("настройки: значения по умолчанию и границы", () => {
  assert.deepEqual(farkle.normalizeOptions({}), { target: 2000, entry: 350, threePairs: false, straights: true });
  assert.deepEqual(farkle.normalizeOptions({ target: 99999, entry: -5, threePairs: true, straights: false }), {
    target: 10000,
    entry: 0,
    threePairs: true,
    straights: false,
  });
  assert.equal(farkle.normalizeOptions({ target: 100 }).target, 1000);
  assert.equal(farkle.normalizeOptions({ entry: 5000 }).entry, 1000);
});

test("scoreSelection: таблица комбинаций", () => {
  const on = rules();
  const off = rules({ straights: false });
  const pairs = rules({ threePairs: true });
  const table = [
    [[1], on, 100],
    [[5], on, 50],
    [[1, 5], on, 150],
    [[5, 5], on, 100],
    [[1, 1], on, 200],
    [[2, 2, 2], on, 200],
    [[3, 3, 3], on, 300],
    [[6, 6, 6], on, 600],
    [[1, 1, 1], on, 1000],
    [[5, 5, 5], on, 500],
    [[2, 2, 2, 2], on, 400],
    [[1, 1, 1, 1], on, 2000],
    [[2, 2, 2, 2, 2], on, 800],
    [[1, 1, 1, 1, 1], on, 4000],
    [[6, 6, 6, 6, 6, 6], on, 4800],
    [[1, 1, 1, 1, 1, 1], on, 8000],
    [[1, 2, 3, 4, 5, 6], on, 1500],
    [[1, 2, 3, 4, 5, 6], off, 1500],
    [[6, 3, 1, 5, 2, 4], off, 1500],
    [[1, 2, 3, 4, 5], on, 500],
    [[1, 2, 3, 4, 5], off, 0],
    [[2, 3, 4, 5, 6], on, 750],
    [[2, 3, 4, 5, 6], off, 0],
    [[1, 2, 3, 4, 5, 5], on, 550],
    [[1, 1, 2, 3, 4, 5], on, 600],
    [[1, 2, 3, 4, 5, 5], off, 0],
    [[2, 3, 4, 5, 6, 6], on, 0],
    [[2, 3, 4, 5, 5, 6], on, 800],
    [[2, 2, 3, 3, 4, 4], pairs, 750],
    [[2, 2, 3, 3, 4, 4], on, 0],
    [[1, 1, 5, 5, 2, 2], pairs, 750],
    [[1, 1, 5, 5, 2, 2], on, 0],
    [[2, 2, 3, 3], pairs, 0],
    [[2, 2, 2, 2, 3, 3], pairs, 0],
    [[1, 1, 1, 1, 5, 5], pairs, 2100],
    [[2], on, 0],
    [[1, 2], on, 0],
    [[2, 2], on, 0],
    [[5, 5, 5, 1], on, 600],
    [[5, 5, 5, 5, 1, 1], on, 1200],
    [[1, 1, 1, 5, 5, 5], on, 1500],
    [[2, 2, 2, 3, 3, 3], on, 500],
    [[2, 2, 2, 3], on, 0],
    [[4, 4, 4, 1, 5], on, 550],
    [[], on, 0],
    [[0], on, 0],
    [[7], on, 0],
    [[1.5], on, 0],
  ];
  for (const [values, r, want] of table) {
    assert.equal(scoreSelection(values, r), want, `${JSON.stringify(values)} ${JSON.stringify(r)}`);
  }
  // без правил — настройки по умолчанию (стриты включены, три пары нет)
  assert.equal(scoreSelection([1, 2, 3, 4, 5]), 500);
  assert.equal(scoreSelection([2, 2, 3, 3, 4, 4]), 0);
  assert.equal(scoreSelection("15", on), 0);
});

test("scoreSelection не зависит от порядка костей", () => {
  const r = rules({ threePairs: true });
  for (const values of [[5, 1, 5, 5], [4, 5, 1, 3, 2, 5], [3, 2, 3, 4, 2, 4], [6, 1, 6, 6, 1, 6]]) {
    const sorted = [...values].sort();
    assert.equal(scoreSelection(values, r), scoreSelection(sorted, r));
    assert.equal(scoreSelection([...values].reverse(), r), scoreSelection(sorted, r));
  }
});

test("hasScore: очковые броски и зонк", () => {
  const on = rules();
  const off = rules({ straights: false });
  const pairs = rules({ threePairs: true });
  assert.equal(hasScore([2, 3, 4, 6, 6, 3], on), false);
  assert.equal(hasScore([2, 3, 4, 6, 6, 3], off), false);
  assert.equal(hasScore([2, 3, 4, 6, 6, 3], pairs), false);
  assert.equal(hasScore([2, 2, 3, 3, 4, 6], on), false);
  assert.equal(hasScore([2, 2, 3, 3, 4, 6], pairs), false);
  assert.equal(hasScore([2, 2, 3, 3, 4, 4], on), false);
  assert.equal(hasScore([2, 2, 3, 3, 4, 4], pairs), true);
  assert.equal(hasScore([2, 3, 4, 6, 6, 1], on), true);
  assert.equal(hasScore([2, 3, 4, 6, 6, 5], off), true);
  assert.equal(hasScore([2, 3, 4, 5, 6, 6], off), true);
  assert.equal(hasScore([2, 2, 2, 3, 4, 6], on), true);
  assert.equal(hasScore([4, 4, 6, 6, 6, 6], on), true);
  assert.equal(hasScore([2], on), false);
  assert.equal(hasScore([5], on), true);
  assert.equal(hasScore([2, 2], pairs), false);
  assert.equal(hasScore([3, 3, 3], on), true);
  assert.equal(hasScore([], on), false);
  assert.equal(hasScore([2, 3, 4, 6]), false);
});

test("hasScore совпадает с перебором всех наборов на всех бросках", () => {
  const rolls = [];
  const grow = (prefix, from) => {
    if (prefix.length > 0) rolls.push(prefix);
    if (prefix.length === 6) return;
    for (let v = from; v <= 6; v++) grow([...prefix, v], v);
  };
  grow([], 1);
  assert.equal(rolls.length, 923);
  for (const threePairs of [false, true]) {
    for (const straights of [false, true]) {
      const r = rules({ threePairs, straights });
      for (const dice of rolls) {
        const brute = subsets(dice.length).some((idx) => scoreSelection(idx.map((i) => dice[i]), r) > 0);
        assert.equal(hasScore(dice, r), brute, `${dice} ${JSON.stringify(r)}`);
        assert.equal(scoringSelections(dice, r).length > 0, brute);
      }
    }
  }
});

// ---------- ход ----------

test("начало партии: пустой ход у первого места", async () => {
  const state = await setup(["a", "b", "c"], { target: 3000, entry: 500, threePairs: true, straights: false });
  assert.deepEqual(state, {
    order: ["a", "b", "c"],
    rules: { target: 3000, entry: 500, threePairs: true, straights: false },
    scores: { a: 0, b: 0, c: 0 },
    entered: { a: false, b: false, c: false },
    current: "a",
    turn: { dice: [], kept: [], points: 0, rolls: 0 },
    winner: null,
    finished: false,
  });
  assert.equal(farkle.currentSeat(state), "a");
  assert.equal(farkle.result(state), null);
  assert.equal(farkle.publicView(state), state);
  assert.equal(farkle.privateView(state, "a"), null);
  assert.equal(farkle.id, "farkle");
  assert.deepEqual(farkle.seats, { min: 2, max: 6 });
  assert.equal(farkle.hasSecrets, false);
});

test("бросок → отложить и бросить → отложить и записать", async () => {
  let state = await setup();
  let events;
  const ctx = makeScriptedCtx([[1, 5, 2, 2, 3, 6], [5, 2, 5, 3, 5]]);

  ({ state, events } = await farkle.apply(state, "a", roll, ctx));
  assert.deepEqual(state.turn, { dice: [1, 5, 2, 2, 3, 6], kept: [], points: 0, rolls: 1 });
  assert.deepEqual(events, [{ type: "rolled", seat: "a", values: [1, 5, 2, 2, 3, 6], hot: false }]);

  ({ state, events } = await farkle.apply(state, "a", keep([0], "roll"), ctx));
  assert.deepEqual(state.turn, { dice: [5, 2, 5, 3, 5], kept: [1], points: 100, rolls: 2 });
  assert.deepEqual(events, [
    { type: "kept", seat: "a", values: [1], score: 100, points: 100 },
    { type: "rolled", seat: "a", values: [5, 2, 5, 3, 5], hot: false },
  ]);
  assert.equal(state.current, "a");

  ({ state, events } = await farkle.apply(state, "a", keep([0, 2, 4], "bank"), ctx));
  assert.deepEqual(events, [
    { type: "kept", seat: "a", values: [5, 5, 5], score: 500, points: 600 },
    { type: "banked", seat: "a", points: 600, total: 600 },
  ]);
  assert.deepEqual(state.scores, { a: 600, b: 0 });
  assert.deepEqual(state.entered, { a: true, b: false });
  assert.equal(state.current, "b");
  assert.deepEqual(state.turn, { dice: [], kept: [], points: 0, rolls: 0 });
  assert.equal(ctx.remaining(), 0);
  assert.equal(farkle.result(state), null);
});

test("отложенные кости копятся в лотке в порядке выбора", async () => {
  let state = await setup();
  const ctx = makeScriptedCtx([[2, 5, 1, 3, 4, 6], [6, 1, 1, 1]]);
  ({ state } = await farkle.apply(state, "a", roll, ctx));
  ({ state } = await farkle.apply(state, "a", keep([2, 1], "roll"), ctx));
  assert.deepEqual(state.turn.kept, [1, 5]);
  assert.deepEqual(state.turn.dice, [6, 1, 1, 1]);
  ({ state } = await farkle.apply(state, "a", keep([1, 2, 3], "bank"), ctx));
  assert.equal(state.scores.a, 1150);
});

test("горячие кости: лоток пуст, бросаются все шесть, очки хода целы", async () => {
  let state = await setup();
  let events;
  const ctx = makeScriptedCtx([[1, 1, 1, 5, 5, 5], [1, 2, 2, 3, 4, 6]]);
  ({ state } = await farkle.apply(state, "a", roll, ctx));
  ({ state, events } = await farkle.apply(state, "a", keep([0, 1, 2, 3, 4, 5], "roll"), ctx));
  assert.deepEqual(state.turn, { dice: [1, 2, 2, 3, 4, 6], kept: [], points: 1500, rolls: 2 });
  assert.deepEqual(events, [
    { type: "kept", seat: "a", values: [1, 1, 1, 5, 5, 5], score: 1500, points: 1500 },
    { type: "rolled", seat: "a", values: [1, 2, 2, 3, 4, 6], hot: true },
  ]);
  assert.equal(state.current, "a");
});

test("горячие кости за два приёма", async () => {
  let state = await setup();
  let events;
  const ctx = makeScriptedCtx([[1, 2, 2, 3, 3, 4], [5, 5, 1, 1, 1], [2, 2, 2, 3, 4, 6], [3, 4, 6]]);
  ({ state } = await farkle.apply(state, "a", roll, ctx));
  ({ state } = await farkle.apply(state, "a", keep([0], "roll"), ctx));
  assert.deepEqual(state.turn.kept, [1]);
  ({ state, events } = await farkle.apply(state, "a", keep([0, 1, 2, 3, 4], "roll"), ctx));
  assert.equal(events[1].hot, true);
  assert.deepEqual(state.turn, { dice: [2, 2, 2, 3, 4, 6], kept: [], points: 1200, rolls: 3 });
  // после горячих костей лоток копится заново, а зонк сжигает всё набранное
  ({ state, events } = await farkle.apply(state, "a", keep([0, 1, 2], "roll"), ctx));
  assert.deepEqual(events.at(-1), { type: "farkle", seat: "a", values: [3, 4, 6], lost: 1400 });
  assert.equal(state.scores.a, 0);
  assert.equal(state.current, "b");
});

test("все кости отложены и записаны — без нового броска", async () => {
  let state = await withDice([1, 1, 1, 5, 5, 5]);
  const ctx = makeScriptedCtx([]);
  let events;
  ({ state, events } = await farkle.apply(state, "a", keep([0, 1, 2, 3, 4, 5], "bank"), ctx));
  assert.deepEqual(types(events), ["kept", "banked"]);
  assert.equal(state.scores.a, 1500);
  assert.equal(state.current, "b");
});

test("зонк: очки хода сгорают, ход переходит", async () => {
  let state = await setup();
  let events;
  const ctx = makeScriptedCtx([[1, 2, 2, 3, 4, 6], [2, 3, 4, 6, 6]]);
  ({ state } = await farkle.apply(state, "a", roll, ctx));
  ({ state, events } = await farkle.apply(state, "a", keep([0], "roll"), ctx));
  assert.deepEqual(events, [
    { type: "kept", seat: "a", values: [1], score: 100, points: 100 },
    { type: "rolled", seat: "a", values: [2, 3, 4, 6, 6], hot: false },
    { type: "farkle", seat: "a", values: [2, 3, 4, 6, 6], lost: 100 },
  ]);
  assert.deepEqual(state.scores, { a: 0, b: 0 });
  assert.equal(state.entered.a, false);
  assert.equal(state.current, "b");
  assert.deepEqual(state.turn, { dice: [], kept: [], points: 0, rolls: 0 });
});

test("зонк первым же броском", async () => {
  let state = await setup(["a", "b", "c"]);
  let events;
  ({ state, events } = await farkle.apply(state, "a", roll, makeScriptedCtx([[2, 2, 3, 3, 4, 6]])));
  assert.deepEqual(events, [
    { type: "rolled", seat: "a", values: [2, 2, 3, 3, 4, 6], hot: false },
    { type: "farkle", seat: "a", values: [2, 2, 3, 3, 4, 6], lost: 0 },
  ]);
  assert.equal(state.current, "b");
  assert.deepEqual(farkle.legalActions(state, "b"), [roll]);
});

test("три пары спасают от зонка только с настройкой", async () => {
  const dice = [2, 2, 3, 3, 4, 4];
  let state = await withDice(dice);
  assert.equal(state.current, "b");
  state = await withDice(dice, { threePairs: true });
  assert.equal(state.current, "a");
  assert.equal(farkle.validate(state, "a", keep([0, 1, 2, 3], "roll")), "badSelection");
  ({ state } = await farkle.apply(state, "a", keep([0, 1, 2, 3, 4, 5], "bank"), makeScriptedCtx([])));
  assert.equal(state.scores.a, 750);
});

test("ход идёт по кругу", async () => {
  let state = await setup(["a", "b", "c"], { entry: 0 });
  const ctx = makeScriptedCtx([[1, 2, 2, 3, 4, 6], [5, 2, 2, 3, 4, 6], [1, 5, 2, 3, 4, 6]]);
  for (const [id, total] of [["a", 100], ["b", 50], ["c", 100]]) {
    assert.equal(state.current, id);
    ({ state } = await farkle.apply(state, id, roll, ctx));
    ({ state } = await farkle.apply(state, id, keep([0], "bank"), ctx));
    assert.equal(state.scores[id], total);
  }
  assert.equal(state.current, "a");
});

test("порог входа: первая запись не меньше entry", async () => {
  let state = await setup();
  const ctx = makeScriptedCtx([[1, 5, 2, 2, 3, 6], [1, 1, 3, 4], [2, 2, 3, 3, 4, 6], [1, 2, 2, 3, 4, 6]]);
  ({ state } = await farkle.apply(state, "a", roll, ctx));
  assert.equal(farkle.validate(state, "a", keep([0, 1], "bank")), "belowEntry");
  await assert.rejects(runAction(farkle, state, "a", keep([0, 1], "bank"), ctx), (e) => e instanceof GameError && e.code === "belowEntry");
  assert.equal(farkle.validate(state, "a", keep([0, 1], "roll")), null);

  ({ state } = await runAction(farkle, state, "a", keep([0, 1], "roll"), ctx));
  // 150 + 100 = 250 — всё ещё мало; 150 + 200 = 350 — ровно порог
  assert.equal(farkle.validate(state, "a", keep([0], "bank")), "belowEntry");
  assert.equal(farkle.validate(state, "a", keep([0, 1], "bank")), null);
  ({ state } = await runAction(farkle, state, "a", keep([0, 1], "bank"), ctx));
  assert.equal(state.scores.a, 350);
  assert.equal(state.entered.a, true);

  // b — зонк; a уже вошёл и может записать хоть сотню
  ({ state } = await runAction(farkle, state, "b", roll, ctx));
  assert.equal(state.current, "a");
  ({ state } = await runAction(farkle, state, "a", roll, ctx));
  assert.equal(farkle.validate(state, "a", keep([0], "bank")), null);
  ({ state } = await runAction(farkle, state, "a", keep([0], "bank"), ctx));
  assert.equal(state.scores.a, 450);
});

test("порог входа 0 — записать можно сразу", async () => {
  let state = await withDice([5, 2, 2, 3, 4, 6], { entry: 0 });
  ({ state } = await runAction(farkle, state, "a", keep([0], "bank"), makeScriptedCtx([])));
  assert.equal(state.scores.a, 50);
  assert.equal(state.entered.a, true);
});

test("набрал цель — победа", async () => {
  let state = await setup(["a", "b"], { target: 1000 });
  let events;
  const ctx = makeScriptedCtx([[1, 1, 1, 2, 3, 4]]);
  ({ state } = await farkle.apply(state, "a", roll, ctx));
  ({ state, events } = await farkle.apply(state, "a", keep([0, 1, 2], "bank"), ctx));
  assert.deepEqual(events, [
    { type: "kept", seat: "a", values: [1, 1, 1], score: 1000, points: 1000 },
    { type: "banked", seat: "a", points: 1000, total: 1000 },
    { type: "won", seat: "a", total: 1000 },
  ]);
  assert.equal(state.winner, "a");
  assert.equal(state.finished, true);
  assert.equal(state.current, null);
  assert.equal(farkle.currentSeat(state), null);
  assert.deepEqual(farkle.result(state), { winners: ["a"], scores: { a: 1000, b: 0 } });
  assert.deepEqual(farkle.legalActions(state, "a"), []);
  assert.equal(farkle.validate(state, "a", roll), "finished");
  assert.equal(farkle.validate(state, "b", roll), "finished");
});

test("до цели не хватило — партия продолжается", async () => {
  let state = await withDice([1, 1, 1, 2, 3, 4], { target: 1500 });
  ({ state } = await farkle.apply(state, "a", keep([0, 1, 2], "bank"), makeScriptedCtx([])));
  assert.equal(state.finished, false);
  assert.equal(state.winner, null);
  assert.equal(state.current, "b");
});

// ---------- проверки ходов ----------

test("validate: коды ошибок", async () => {
  const fresh = await setup();
  assert.equal(farkle.validate(fresh, "a", roll), null);
  assert.equal(farkle.validate(fresh, "b", roll), "notYourTurn");
  assert.equal(farkle.validate(fresh, "zzz", roll), "notYourTurn");
  assert.equal(farkle.validate(fresh, "a", keep([0], "roll")), "mustRoll");
  assert.equal(farkle.validate(fresh, "a", keep([0], "bank")), "mustRoll");
  assert.equal(farkle.validate(fresh, "a", { type: "stop" }), "badAction");
  assert.equal(farkle.validate(fresh, "a", {}), "badAction");
  assert.equal(farkle.validate(fresh, "a", null), "badAction");
  assert.equal(farkle.validate(fresh, "a", undefined), "badAction");

  const state = await withDice([1, 5, 2, 2, 3, 6]);
  assert.equal(farkle.validate(state, "a", roll), "mustKeep");
  assert.equal(farkle.validate(state, "b", keep([0], "roll")), "notYourTurn");
  assert.equal(farkle.validate(state, "a", keep([0], "roll")), null);
  assert.equal(farkle.validate(state, "a", keep([1, 0], "roll")), null);
  assert.equal(farkle.validate(state, "a", keep([0], "stop")), "badAction");
  assert.equal(farkle.validate(state, "a", { type: "keep", indices: [0] }), "badAction");
  assert.equal(farkle.validate(state, "a", keep([], "roll")), "badSelection");
  assert.equal(farkle.validate(state, "a", keep(undefined, "roll")), "badSelection");
  assert.equal(farkle.validate(state, "a", keep("0", "roll")), "badSelection");
  assert.equal(farkle.validate(state, "a", keep([0, 0], "roll")), "badSelection");
  assert.equal(farkle.validate(state, "a", keep([6], "roll")), "badSelection");
  assert.equal(farkle.validate(state, "a", keep([-1], "roll")), "badSelection");
  assert.equal(farkle.validate(state, "a", keep([0.5], "roll")), "badSelection");
  assert.equal(farkle.validate(state, "a", keep(["0"], "roll")), "badSelection");
  assert.equal(farkle.validate(state, "a", keep([2], "roll")), "badSelection");
  assert.equal(farkle.validate(state, "a", keep([0, 2], "roll")), "badSelection");
  assert.equal(farkle.validate(state, "a", keep([2, 3], "bank")), "badSelection");
  assert.equal(farkle.validate(state, "a", keep([0, 1], "bank")), "belowEntry");
  await assert.rejects(runAction(farkle, state, "a", roll, makeScriptedCtx([])), (e) => e.code === "mustKeep");
});

test("legalActions: до броска — только бросок, потом — очковые наборы", async () => {
  const fresh = await setup();
  assert.deepEqual(farkle.legalActions(fresh, "a"), [roll]);
  assert.deepEqual(farkle.legalActions(fresh, "b"), []);

  const closed = await withDice([1, 5, 2, 2, 3, 6]);
  assert.deepEqual(farkle.legalActions(closed, "b"), []);
  assert.deepEqual(farkle.legalActions(closed, "a"), [keep([0], "roll"), keep([1], "roll"), keep([0, 1], "roll")]);

  const open = await withDice([1, 5, 2, 2, 3, 6], { entry: 100 });
  assert.deepEqual(farkle.legalActions(open, "a"), [
    keep([0], "roll"),
    keep([0], "bank"),
    keep([1], "roll"),
    keep([0, 1], "roll"),
    keep([0, 1], "bank"),
  ]);

  for (const dice of [[1, 1, 1, 5, 5, 2], [2, 3, 4, 5, 6, 6], [4, 4, 4, 4, 1, 5], [1, 2, 3, 4, 5, 6]]) {
    for (const entry of [0, 350, 1000]) {
      const state = await withDice(dice, { entry });
      const actions = farkle.legalActions(state, "a");
      assert.ok(actions.length > 0);
      for (const action of actions) assert.equal(farkle.validate(state, "a", action), null, JSON.stringify(action));
      // и наоборот: всё, что проходит проверку, есть в списке
      const listed = new Set(actions.map((a) => JSON.stringify(a)));
      for (const indices of subsets(dice.length)) {
        for (const then of ["roll", "bank"]) {
          const ok = farkle.validate(state, "a", keep(indices, then)) === null;
          assert.equal(listed.has(JSON.stringify(keep(indices, then))), ok);
        }
      }
    }
  }
});

test("apply и removeSeat не меняют входное состояние", async () => {
  const state = await withDice([1, 5, 2, 2, 3, 6], { entry: 0 });
  const before = JSON.stringify(state);
  await farkle.apply(state, "a", keep([0, 1], "roll"), makeScriptedCtx([[1, 1, 1, 1]]));
  await farkle.apply(state, "a", keep([0, 1], "roll"), makeScriptedCtx([[2, 3, 4, 6]]));
  await farkle.apply(state, "a", keep([0, 1], "bank"), makeScriptedCtx([]));
  await farkle.removeSeat(state, "a", makeScriptedCtx([]));
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(JSON.parse(before), state);
});

// ---------- уход из-за стола ----------

test("ушедший игрок: остался один — он и выиграл", async () => {
  let state = await setup();
  let events;
  ({ state, events } = await farkle.removeSeat(state, "a", makeScriptedCtx([])));
  assert.deepEqual(events, [{ type: "left", seat: "a" }, { type: "won", seat: "b", total: 0 }]);
  assert.deepEqual(farkle.result(state), { winners: ["b"], scores: { b: 0 } });
  assert.equal(state.current, null);
  assert.deepEqual(state.order, ["b"]);
});

test("ушёл текущий — следующий начинает ход заново", async () => {
  let state = await withDice([1, 5, 2, 2, 3, 6], {}, ["a", "b", "c"]);
  let events;
  ({ state } = await farkle.apply(state, "a", keep([0], "roll"), makeScriptedCtx([[1, 2, 3, 4, 6]])));
  assert.equal(state.turn.points, 100);
  ({ state, events } = await farkle.removeSeat(state, "a", makeScriptedCtx([])));
  assert.deepEqual(events, [{ type: "left", seat: "a" }]);
  assert.equal(state.current, "b");
  assert.deepEqual(state.order, ["b", "c"]);
  assert.deepEqual(state.scores, { b: 0, c: 0 });
  assert.deepEqual(state.entered, { b: false, c: false });
  assert.deepEqual(state.turn, { dice: [], kept: [], points: 0, rolls: 0 });
  assert.deepEqual(farkle.legalActions(state, "b"), [roll]);
});

test("ушёл текущий в конце круга — ход у первого", async () => {
  let state = await setup(["a", "b", "c"]);
  const zonk = [2, 2, 3, 3, 4, 6];
  ({ state } = await farkle.apply(state, "a", roll, makeScriptedCtx([zonk])));
  ({ state } = await farkle.apply(state, "b", roll, makeScriptedCtx([zonk])));
  assert.equal(state.current, "c");
  ({ state } = await farkle.removeSeat(state, "c", makeScriptedCtx([])));
  assert.equal(state.current, "a");
  assert.deepEqual(state.order, ["a", "b"]);
});

test("ушёл не текущий — ход и набранное остаются", async () => {
  let state = await withDice([1, 5, 2, 2, 3, 6], {}, ["a", "b", "c"]);
  const turn = structuredClone(state.turn);
  ({ state } = await farkle.removeSeat(state, "b", makeScriptedCtx([])));
  assert.equal(state.current, "a");
  assert.deepEqual(state.turn, turn);
  assert.deepEqual(state.order, ["a", "c"]);
  // после ухода b ход от a переходит сразу к c
  ({ state } = await farkle.apply(state, "a", keep([0], "roll"), makeScriptedCtx([[2, 3, 4, 6, 6]])));
  assert.equal(state.current, "c");
});

test("уход постороннего или после конца партии ничего не меняет", async () => {
  let state = await setup(["a", "b", "c"]);
  let events;
  const before = structuredClone(state);
  ({ state, events } = await farkle.removeSeat(state, "zzz", makeScriptedCtx([])));
  assert.deepEqual(events, [{ type: "left", seat: "zzz" }]);
  assert.deepEqual(state, before);

  let done = await withDice([1, 1, 1, 2, 3, 4], { target: 1000 });
  ({ state: done } = await farkle.apply(done, "a", keep([0, 1, 2], "bank"), makeScriptedCtx([])));
  const after = (await farkle.removeSeat(done, "b", makeScriptedCtx([]))).state;
  assert.deepEqual(after, done);
  assert.deepEqual(farkle.result(after).winners, ["a"]);
});

test("ушедший с очками не мешает победе оставшегося", async () => {
  let state = await withDice([1, 1, 1, 2, 3, 4], { target: 2000 }, ["a", "b", "c"]);
  ({ state } = await farkle.apply(state, "a", keep([0, 1, 2], "bank"), makeScriptedCtx([])));
  ({ state } = await farkle.removeSeat(state, "b", makeScriptedCtx([])));
  let events;
  ({ state, events } = await farkle.removeSeat(state, "c", makeScriptedCtx([])));
  assert.deepEqual(events.at(-1), { type: "won", seat: "a", total: 1000 });
  assert.deepEqual(farkle.result(state), { winners: ["a"], scores: { a: 1000 } });
});

// ---------- бот ----------

const decide = (state, seatId, temp, seed = 1) =>
  bot({
    view: structuredClone(farkle.publicView(state)),
    mine: null,
    seatId,
    options: state.rules,
    temperament: temperament(temp),
    rng: mulberry32(seed),
  });

test("бот: без костей на сукне бросает", async () => {
  const state = await setup();
  for (const temp of TEMPERAMENT_IDS) assert.deepEqual(decide(state, "a", temp), roll);
});

test("бот: лишнюю пятёрку оставляет катиться, все очковые — берёт все", async () => {
  // rng всегда 0 — бот не ошибается
  const sure = (state) =>
    bot({ view: state, mine: null, seatId: "a", options: state.rules, temperament: temperament("counter"), rng: () => 0 });
  assert.deepEqual(sure(await withDice([1, 5, 2, 2, 3, 6])), keep([0], "roll"));
  assert.deepEqual(sure(await withDice([1, 1, 5, 5, 5, 5])), keep([0, 1, 2, 3, 4, 5], "roll"));
  assert.deepEqual(sure(await withDice([1, 2, 3, 4, 5, 6])), keep([0, 1, 2, 3, 4, 5], "roll"));
});

test("бот: победную запись делает всегда, порог входа не нарушает", async () => {
  const winning = await withDice([1, 1, 1, 5, 2, 3], { target: 1000 });
  const blocked = await withDice([1, 5, 2, 2, 3, 6], { entry: 1000 });
  for (const temp of TEMPERAMENT_IDS) {
    for (let seed = 1; seed <= 50; seed++) {
      assert.deepEqual(decide(winning, "a", temp, seed), keep([0, 1, 2, 3], "bank"));
      const action = decide(blocked, "a", temp, seed);
      assert.equal(action.then, "roll");
      assert.equal(farkle.validate(blocked, "a", action), null);
    }
  }
});

test("бот: с большим счётом хода и одной костью записывает", async () => {
  let state = await withDice([1, 1, 1, 5, 2, 3], { target: 5000 });
  ({ state } = await farkle.apply(state, "a", keep([0, 1, 2, 3], "roll"), makeScriptedCtx([[5, 2]])));
  const action = bot({ view: state, mine: null, seatId: "a", options: state.rules, temperament: temperament("counter"), rng: () => 0 });
  assert.deepEqual(action, keep([0], "bank"));
});

test("боты доигрывают 1800 партий без недопустимых ходов", async () => {
  const targets = [1000, 2000, 1500, 3000];
  const entries = [0, 350, 500, 1000];
  const seen = { farkle: 0, hot: 0, banked: 0 };
  for (let seed = 1; seed <= 1800; seed++) {
    const seats = 2 + (seed % 5);
    const options = {
      target: targets[seed % targets.length],
      entry: entries[Math.floor(seed / 4) % entries.length],
      threePairs: Math.floor(seed / 16) % 2 === 1,
      straights: Math.floor(seed / 32) % 2 === 0,
    };
    const { state, result, events, seatIds } = await simulate(farkle, bot, {
      seats,
      seed,
      options,
      onStep({ state: s, seatId, action, events: evs }) {
        assert.ok(evs.length > 0);
        assert.ok(evs.every((e) => e.seat === seatId));
        assert.equal(evs[0].type, action.type === "roll" ? "rolled" : "kept");
        assert.ok(s.turn.dice.length <= 6 && s.turn.kept.length <= 6);
        if (!s.finished) assert.ok(s.order.includes(s.current));
      },
    });
    assert.equal(result.winners.length, 1, `seed ${seed}`);
    const [winner] = result.winners;
    assert.equal(state.winner, winner);
    assert.ok(result.scores[winner] >= state.rules.target);
    for (const id of seatIds) {
      if (id !== winner) assert.ok(result.scores[id] < state.rules.target);
      const banked = events.filter((e) => e.type === "banked" && e.seat === id);
      assert.equal(banked.reduce((a, e) => a + e.points, 0), result.scores[id]);
      if (banked.length > 0) assert.ok(banked[0].points >= state.rules.entry);
      assert.equal(state.entered[id], banked.length > 0);
    }
    assert.deepEqual(events.at(-1), { type: "won", seat: winner, total: result.scores[winner] });
    seen.farkle += events.filter((e) => e.type === "farkle").length;
    seen.hot += events.filter((e) => e.type === "rolled" && e.hot).length;
    seen.banked += events.filter((e) => e.type === "banked").length;
  }
  assert.ok(seen.farkle > 0 && seen.hot > 0 && seen.banked > 0);
});
