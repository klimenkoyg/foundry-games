import assert from "node:assert/strict";
import { test } from "node:test";

import bot from "../scripts/core/bots/kb.mjs";
import { makeScriptedCtx } from "../scripts/core/engine.mjs";
import kb, { boardScore, columnScore } from "../scripts/core/games/kb.mjs";
import { pick } from "../scripts/core/util.mjs";
import { simulate } from "./helpers/sim.mjs";

const place = (col) => ({ type: "place", col });

/** Разыгрывает ходы по очереди (a, b, a, …): moves = [[col, value], …].
    Значения костей уходят в сценарий бросков; nextDie — бросок после последнего хода. */
async function play(moves, nextDie) {
  const queue = moves.map(([, value]) => [value]);
  if (nextDie) queue.push([nextDie]);
  const ctx = makeScriptedCtx(queue);
  let state = await kb.setup({ seatIds: ["a", "b"], options: kb.normalizeOptions({}), ctx });
  let events = [];
  for (const [col] of moves) {
    ({ state, events } = await kb.apply(state, state.current, place(col), ctx));
  }
  return { state, events, ctx };
}

/** Перемежает ходы двух игроков: a ходит первым. */
const interleave = (a, b) => a.flatMap((move, i) => (b[i] ? [move, b[i]] : [move]));

const fill = (values) => values.map((value, i) => [Math.floor(i / 3), value]);

test("очки столбца: значение × количество в квадрате", () => {
  assert.equal(columnScore([4, 4]), 16);
  assert.equal(columnScore([4, 4, 4]), 36);
  assert.equal(columnScore([1, 2, 3]), 6);
  assert.equal(columnScore([6, 6, 1]), 25);
  assert.equal(columnScore([]), 0);
  assert.equal(boardScore([[4, 4], [6, 6, 1], []]), 41);
  assert.equal(boardScore([[], [], []]), 0);
});

test("начало: пустые доски, первый бросок уже сделан", async () => {
  const ctx = makeScriptedCtx([[4]]);
  const state = await kb.setup({ seatIds: ["a", "b"], options: {}, ctx });
  assert.equal(ctx.remaining(), 0);
  assert.deepEqual(state.order, ["a", "b"]);
  assert.equal(state.current, "a");
  assert.equal(state.die, 4);
  assert.deepEqual(state.boards, { a: [[], [], []], b: [[], [], []] });
  assert.deepEqual(state.totals, { a: 0, b: 0 });
  assert.equal(state.turnCount, 0);
  assert.equal(kb.currentSeat(state), "a");
  assert.equal(kb.result(state), null);
  assert.deepEqual(kb.legalActions(state, "a"), [place(0), place(1), place(2)]);
  assert.deepEqual(kb.legalActions(state, "b"), []);
  assert.deepEqual(kb.normalizeOptions({ any: 1 }), {});
});

test("постановка: кость встаёт в столбец, ход и новый бросок — сопернику", async () => {
  const ctx = makeScriptedCtx([[4], [2]]);
  const start = await kb.setup({ seatIds: ["a", "b"], options: {}, ctx });
  const { state, events } = await kb.apply(start, "a", place(1), ctx);
  assert.deepEqual(state.boards.a, [[], [4], []]);
  assert.deepEqual(state.totals, { a: 4, b: 0 });
  assert.equal(state.current, "b");
  assert.equal(state.die, 2);
  assert.equal(state.turnCount, 1);
  assert.deepEqual(events, [
    { type: "placed", seat: "a", col: 1, value: 4, knocked: 0 },
    { type: "rolledDie", seat: "b", value: 2 },
  ]);
  // вход не изменился
  assert.deepEqual(start.boards.a, [[], [], []]);
  assert.equal(start.current, "a");
});

test("выбиваются кости того же значения только в том же столбце", async () => {
  // a: 4 в первый; b: 4 во второй — мимо; a: вторая 4 в первый; b: 4 в первый — выбивает обе
  let { state, events } = await play([[0, 4], [1, 4], [0, 4]], 4);
  assert.deepEqual(state.boards.a, [[4, 4], [], []]);
  assert.deepEqual(state.boards.b, [[], [4], []]);
  assert.deepEqual(state.totals, { a: 16, b: 4 });
  assert.equal(events[0].knocked, 0);

  ({ state, events } = await kb.apply(state, "b", place(0), makeScriptedCtx([[1]])));
  assert.deepEqual(state.boards.a, [[], [], []]);
  assert.deepEqual(state.boards.b, [[4], [4], []]);
  assert.deepEqual(state.totals, { a: 0, b: 8 });
  assert.deepEqual(events[0], { type: "placed", seat: "b", col: 0, value: 4, knocked: 2 });
});

test("другие значения в столбце остаются на месте", async () => {
  const { state, events } = await play([[0, 4], [2, 1], [0, 5], [0, 4]], 3);
  assert.deepEqual(state.boards.a, [[5], [], []]);
  assert.deepEqual(state.boards.b, [[4], [], [1]]);
  assert.deepEqual(state.totals, { a: 5, b: 5 });
  assert.equal(events[0].knocked, 1);
  assert.equal(state.current, "a");
  assert.equal(state.die, 3);
});

test("заполненная доска сразу заканчивает партию, больше очков — победа", async () => {
  const { state, events, ctx } = await play(interleave(fill(Array(9).fill(6)), fill(Array(8).fill(1))));
  assert.equal(ctx.remaining(), 0);
  assert.equal(state.finished, true);
  assert.equal(state.current, null);
  assert.equal(state.die, null);
  assert.equal(state.turnCount, 17);
  assert.equal(kb.currentSeat(state), null);
  assert.deepEqual(state.totals, { a: 162, b: 22 });
  assert.deepEqual(events, [
    { type: "placed", seat: "a", col: 2, value: 6, knocked: 0 },
    { type: "won", seat: "a", totals: { a: 162, b: 22 } },
  ]);
  assert.deepEqual(kb.result(state), { winners: ["a"], draw: false, scores: { a: 162, b: 22 } });
  assert.deepEqual(kb.legalActions(state, "a"), []);
});

test("заполнил доску первым, но очков меньше — победа соперника", async () => {
  const { state, events } = await play(interleave(fill(Array(9).fill(1)), fill(Array(8).fill(6))));
  assert.equal(state.finished, true);
  assert.equal(state.winner, "b");
  assert.deepEqual(state.totals, { a: 27, b: 132 });
  assert.equal(events.at(-1).type, "won");
  assert.equal(events.at(-1).seat, "b");
  assert.deepEqual(kb.result(state).winners, ["b"]);
});

test("поровну очков — ничья", async () => {
  // a: [2,2,2] [2,2,1] [1,1,2] = 18 + 9 + 6; b: [3,4,5] [3,4,5] [4,5] = 12 + 12 + 9
  const { state, events } = await play(interleave(fill([2, 2, 2, 2, 2, 1, 1, 1, 2]), fill([3, 4, 5, 3, 4, 5, 4, 5])));
  assert.deepEqual(state.totals, { a: 33, b: 33 });
  assert.equal(state.finished, true);
  assert.equal(state.winner, null);
  assert.equal(state.draw, true);
  assert.deepEqual(events.at(-1), { type: "draw", totals: { a: 33, b: 33 } });
  assert.deepEqual(kb.result(state), { winners: [], draw: true, scores: { a: 33, b: 33 } });
});

test("коды ошибок", async () => {
  const { state } = await play([[0, 4], [0, 1], [0, 4], [0, 2], [0, 5], [0, 3]], 6);
  // у a первый столбец полон: [4, 4, 5]
  assert.equal(state.current, "a");
  assert.equal(kb.validate(state, "b", place(1)), "notYourTurn");
  assert.equal(kb.validate(state, "a", { type: "roll" }), "badAction");
  assert.equal(kb.validate(state, "a", null), "badAction");
  assert.equal(kb.validate(state, "a", undefined), "badAction");
  for (const col of [3, -1, 1.5, "1", null, undefined]) {
    assert.equal(kb.validate(state, "a", { type: "place", col }), "badCol");
  }
  assert.equal(kb.validate(state, "a", place(0)), "colFull");
  assert.equal(kb.validate(state, "a", place(1)), null);
  assert.deepEqual(kb.legalActions(state, "a"), [place(1), place(2)]);

  const over = await play(interleave(fill(Array(9).fill(6)), fill(Array(8).fill(1))));
  assert.equal(kb.validate(over.state, "a", place(0)), "finished");
  assert.equal(kb.validate(over.state, "b", place(0)), "finished");
});

test("ушедший игрок: соперник выигрывает", async () => {
  const { state: before } = await play([[0, 4], [1, 2]], 5);
  const snapshot = JSON.stringify(before);
  const { state, events } = await kb.removeSeat(before, "a", makeScriptedCtx([]));
  assert.equal(JSON.stringify(before), snapshot);
  assert.deepEqual(events, [
    { type: "left", seat: "a" },
    { type: "won", seat: "b", totals: { a: 4, b: 2 } },
  ]);
  assert.equal(state.finished, true);
  assert.equal(state.winner, "b");
  assert.equal(state.draw, false);
  assert.equal(state.current, null);
  assert.equal(state.die, null);
  assert.deepEqual(kb.result(state), { winners: ["b"], draw: false, scores: { a: 4, b: 2 } });

  // уходит не тот, чей ход, — выигрывает оставшийся
  const other = await kb.removeSeat(before, "b", makeScriptedCtx([]));
  assert.deepEqual(kb.result(other.state).winners, ["a"]);

  // после конца партии уход ничего не меняет
  const again = await kb.removeSeat(state, "b", makeScriptedCtx([]));
  assert.deepEqual(again.events, [{ type: "left", seat: "b" }]);
  assert.equal(again.state.winner, "b");
});

test("боты доигрывают 3000 партий без недопустимых ходов", async () => {
  for (let seed = 1; seed <= 3000; seed++) {
    const { state, result, steps, seatIds } = await simulate(kb, bot, { seats: 2, seed });
    assert.equal(state.finished, true);
    assert.equal(result.winners.length === 1 || result.draw === true, true);
    assert.equal(result.winners.length === 1, !result.draw);
    assert.equal(steps, state.turnCount);
    const [a, b] = seatIds;
    for (const id of seatIds) {
      assert.equal(state.totals[id], boardScore(state.boards[id]));
      assert.equal(state.boards[id].every((column) => column.length <= 3), true);
    }
    // партию закончила полная доска
    assert.equal(seatIds.some((id) => state.boards[id].every((column) => column.length === 3)), true);
    if (result.draw) {
      assert.equal(state.totals[a], state.totals[b]);
    } else {
      const loser = result.winners[0] === a ? b : a;
      assert.equal(state.totals[result.winners[0]] > state.totals[loser], true);
    }
  }
});

test("бот чаще обыгрывает того, кто ставит наугад", async () => {
  const randomBot = ({ view, seatId, rng }) =>
    place(pick(rng, [0, 1, 2].filter((col) => view.boards[seatId][col].length < 3)));
  let wins = 0;
  let losses = 0;
  for (let seed = 1; seed <= 500; seed++) {
    // через партию меняются местами, чтобы первый ход не давал перевеса
    const smart = seed % 2 ? "s1" : "s2";
    const duel = (args) => (args.seatId === smart ? bot : randomBot)(args);
    const { result } = await simulate(kb, duel, { seats: 2, seed });
    if (result.draw) continue;
    if (result.winners[0] === smart) wins++;
    else losses++;
  }
  assert.equal(wins > losses * 1.5, true, `побед ${wins}, поражений ${losses}`);
});
