import assert from "node:assert/strict";
import { test } from "node:test";

import bot from "../scripts/core/bots/scc.mjs";
import { makeScriptedCtx } from "../scripts/core/engine.mjs";
import scc from "../scripts/core/games/scc.mjs";
import { simulate } from "./helpers/sim.mjs";

const setup = (seatIds = ["a", "b"], options = {}) =>
  scc.setup({ seatIds, options: scc.normalizeOptions(options), ctx: makeScriptedCtx([]) });

test("корабль, капитан и команда в одном броске — сразу груз", async () => {
  let state = await setup();
  const ctx = makeScriptedCtx([[4, 6, 2, 5, 3]]);
  ({ state } = await scc.apply(state, "a", { type: "roll" }, ctx));
  const h = state.hands.a;
  assert.equal(h.ship && h.captain && h.crew, true);
  assert.deepEqual(h.dice.sort(), [2, 3]);
  assert.equal(h.rolls, 1);
  assert.equal(h.done, false);
});

test("порядок важен: пятёрка без шестёрки не встаёт", async () => {
  let state = await setup();
  const ctx = makeScriptedCtx([[5, 4, 1, 2, 3], [6, 5, 2, 2, 1]]);
  ({ state } = await scc.apply(state, "a", { type: "roll" }, ctx));
  assert.equal(state.hands.a.ship, false);
  assert.equal(state.hands.a.captain, false);
  ({ state } = await scc.apply(state, "a", { type: "roll" }, ctx));
  // во втором броске четвёрки нет — встают только 6 и 5
  assert.equal(state.hands.a.ship, true);
  assert.equal(state.hands.a.captain, true);
  assert.equal(state.hands.a.crew, false);
});

test("три броска без команды — ноль и ход переходит", async () => {
  let state = await setup();
  const ctx = makeScriptedCtx([[1, 1, 1, 1, 1], [2, 2, 2, 2, 2], [3, 3, 3, 3, 3]]);
  for (let i = 0; i < 3; i++) ({ state } = await scc.apply(state, "a", { type: "roll" }, ctx));
  assert.equal(state.hands.a.score, 0);
  assert.equal(state.current, "b");
});

test("остановиться можно только с командой", async () => {
  let state = await setup();
  assert.equal(scc.validate(state, "a", { type: "stop" }), "noCrew");
  ({ state } = await scc.apply(state, "a", { type: "roll" }, makeScriptedCtx([[6, 5, 4, 6, 6]])));
  assert.equal(scc.validate(state, "a", { type: "stop" }), null);
  assert.equal(scc.validate(state, "b", { type: "roll" }), "notYourTurn");
});

test("лучший груз выигрывает", async () => {
  let state = await setup();
  const ctx = makeScriptedCtx([[6, 5, 4, 6, 6], [6, 5, 4, 1, 2]]);
  ({ state } = await scc.apply(state, "a", { type: "roll" }, ctx));
  ({ state } = await scc.apply(state, "a", { type: "stop" }, ctx));
  ({ state } = await scc.apply(state, "b", { type: "roll" }, ctx));
  ({ state } = await scc.apply(state, "b", { type: "stop" }, ctx));
  assert.deepEqual(scc.result(state).winners, ["a"]);
  assert.equal(scc.result(state).scores.a, 12);
});

test("ничья — переигровка только между равными", async () => {
  let state = await setup(["a", "b", "c"]);
  const ctx = makeScriptedCtx([[6, 5, 4, 3, 3], [6, 5, 4, 4, 2], [6, 5, 4, 1, 1]]);
  for (const id of ["a", "b", "c"]) {
    ({ state } = await scc.apply(state, id, { type: "roll" }, ctx));
    ({ state } = await scc.apply(state, id, { type: "stop" }, ctx));
  }
  assert.equal(scc.result(state), null);
  assert.deepEqual(state.contenders, ["a", "b"]);
  assert.equal(state.round, 2);
  assert.equal(state.current, "a");
});

test("у всех ноль — переигровка всеми", async () => {
  let state = await setup(["a", "b"], { rolls: 2 });
  const ctx = makeScriptedCtx([[1, 1, 1, 1, 1], [1, 1, 1, 1, 1], [2, 2, 2, 2, 2], [2, 2, 2, 2, 2]]);
  for (const id of ["a", "b"]) {
    ({ state } = await scc.apply(state, id, { type: "roll" }, ctx));
    ({ state } = await scc.apply(state, id, { type: "roll" }, ctx));
  }
  assert.equal(state.round, 2);
  assert.deepEqual(state.contenders, ["a", "b"]);
});

test("ушедший игрок: остался один — он и выиграл", async () => {
  let state = await setup();
  ({ state } = await scc.removeSeat(state, "a", makeScriptedCtx([])));
  assert.deepEqual(scc.result(state).winners, ["b"]);
});

test("ушёл текущий — ход переходит к следующему", async () => {
  let state = await setup(["a", "b", "c"]);
  ({ state } = await scc.removeSeat(state, "a", makeScriptedCtx([])));
  assert.equal(state.current, "b");
  assert.deepEqual(state.order, ["b", "c"]);
});

test("боты доигрывают 2000 партий без недопустимых ходов", async () => {
  for (let seed = 1; seed <= 2000; seed++) {
    const seats = 2 + (seed % 7);
    const { result } = await simulate(scc, bot, { seats, seed });
    assert.equal(result.winners.length, 1);
  }
});
