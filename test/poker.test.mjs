import assert from "node:assert/strict";
import { test } from "node:test";

import bot from "../scripts/core/bots/poker.mjs";
import { GameError, makeScriptedCtx, runAction } from "../scripts/core/engine.mjs";
import poker, { HAND_RANKS, compareHands, evaluateHand } from "../scripts/core/games/poker.mjs";
import { mulberry32 } from "../scripts/core/util.mjs";
import { simulate } from "./helpers/sim.mjs";

const setup = (seatIds, options, rolls) =>
  poker.setup({ seatIds, options: poker.normalizeOptions(options), ctx: makeScriptedCtx(rolls) });

/** Проводит ходы через validate + apply и собирает события. */
async function play(state, ctx, moves) {
  const events = [];
  for (const [seat, action] of moves) {
    const res = await runAction(poker, state, seat, action, ctx);
    state = res.state;
    events.push(...res.events);
  }
  return { state, events };
}

const CHECK = { type: "check" };
const BET = { type: "bet" };
const CALL = { type: "call" };
const FOLD = { type: "fold" };
const KEEP = { type: "reroll", indices: [] };
const NO_ROLLS = makeScriptedCtx([]);

const types = (events) => events.map((e) => e.type);

test("комбинации: каждый ранг и грани для сравнения", () => {
  const cases = [
    [[1, 2, 3, 5, 6], "nothing", [6, 5, 3, 2, 1]],
    [[2, 2, 6, 4, 1], "pair", [2, 6, 4, 1]],
    [[5, 5, 3, 3, 1], "twoPairs", [5, 3, 1]],
    [[4, 1, 4, 6, 4], "three", [4, 6, 1]],
    [[3, 1, 5, 2, 4], "smallStraight", []],
    [[6, 2, 4, 3, 5], "bigStraight", []],
    [[3, 3, 3, 6, 6], "fullHouse", [3, 6]],
    [[6, 2, 2, 2, 2], "four", [2, 6]],
    [[1, 1, 1, 1, 1], "five", [1]],
  ];
  for (const [values, name, tiebreak] of cases) {
    assert.deepEqual(evaluateHand(values), { rank: HAND_RANKS.indexOf(name), name, tiebreak }, name);
  }
  assert.deepEqual(HAND_RANKS, ["nothing", "pair", "twoPairs", "three", "smallStraight", "bigStraight", "fullHouse", "four", "five"]);
  // пять разных граней с единицей и шестёркой — не стрит
  assert.equal(evaluateHand([1, 3, 4, 5, 6]).name, "nothing");
  assert.equal(evaluateHand([1, 2, 3, 4, 6]).name, "nothing");
});

test("сравнение: старшинство комбинаций", () => {
  const ladder = [
    [1, 1, 1, 1, 1], // покер
    [6, 6, 6, 6, 5], // каре
    [6, 6, 6, 5, 5], // фулл-хаус
    [2, 3, 4, 5, 6], // большой стрит
    [1, 2, 3, 4, 5], // малый стрит
    [6, 6, 6, 5, 4], // тройка
    [6, 6, 5, 5, 4], // две пары
    [6, 6, 5, 4, 3], // пара
    [6, 5, 4, 3, 1], // ничего
  ];
  for (let i = 0; i < ladder.length; i++) {
    for (let j = 0; j < ladder.length; j++) {
      assert.equal(Math.sign(compareHands(ladder[i], ladder[j])), Math.sign(j - i), `${ladder[i]} против ${ladder[j]}`);
    }
  }
});

test("сравнение: равные ранги решают грани", () => {
  assert.ok(compareHands([6, 6, 1, 2, 3], [5, 5, 6, 4, 3]) > 0); // пара шестёрок старше пары пятёрок
  assert.ok(compareHands([4, 4, 6, 2, 1], [4, 4, 5, 3, 2]) > 0); // пары равны — старшая из остальных
  assert.ok(compareHands([4, 4, 6, 3, 1], [4, 4, 6, 2, 1]) > 0); // вторая из остальных
  assert.ok(compareHands([5, 5, 2, 2, 6], [4, 4, 3, 3, 6]) > 0); // две пары: по старшей паре
  assert.ok(compareHands([5, 5, 3, 3, 1], [5, 5, 2, 2, 6]) > 0); // потом по младшей
  assert.ok(compareHands([2, 2, 2, 3, 3], [1, 1, 1, 6, 6]) > 0); // фулл-хаус: по тройке
  assert.ok(compareHands([6, 5, 4, 3, 1], [6, 5, 4, 2, 1]) > 0); // ничего: старшие грани
  assert.ok(compareHands([2, 2, 2, 2, 2], [1, 1, 1, 1, 1]) > 0);
  assert.equal(compareHands([3, 3, 5, 4, 1], [1, 3, 4, 3, 5]), 0);
  assert.equal(compareHands([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]), 0);
  assert.ok(compareHands([5, 5, 6, 4, 3], [6, 6, 1, 2, 3]) < 0);
  // принимает и уже оценённые руки, и записи вскрытия
  assert.ok(compareHands(evaluateHand([6, 6, 1, 2, 3]), evaluateHand([5, 5, 6, 4, 3])) > 0);
  assert.ok(compareHands({ values: [6, 6, 1, 2, 3], rank: 1, name: "pair" }, [5, 5, 6, 4, 3]) > 0);
});

test("настройки приводятся к границам", () => {
  assert.deepEqual(poker.normalizeOptions({}), { handsToWin: 2, betting: true, raise: 5, maxRaises: 2 });
  assert.deepEqual(poker.normalizeOptions({ handsToWin: 9, betting: false, raise: 0, maxRaises: 7 }), {
    handsToWin: 3,
    betting: false,
    raise: 1,
    maxRaises: 4,
  });
});

test("раздача: по пять открытых костей, первым ходит сдающий", async () => {
  const state = await setup(["a", "b", "c"], {}, [[6, 6, 3, 2, 1], [5, 5, 4, 2, 1], [1, 2, 3, 4, 6]]);
  assert.deepEqual(state.dice, { a: [6, 6, 3, 2, 1], b: [5, 5, 4, 2, 1], c: [1, 2, 3, 4, 6] });
  assert.deepEqual(state.order, ["a", "b", "c"]);
  assert.deepEqual(state.rules, { handsToWin: 2, betting: true, raise: 5, maxRaises: 2 });
  assert.equal(state.handNo, 1);
  assert.equal(state.dealer, "a");
  assert.equal(state.phase, "bet1");
  assert.equal(state.current, "a");
  assert.deepEqual(state.handWins, { a: 0, b: 0, c: 0 });
  assert.deepEqual(state.bets, { a: 0, b: 0, c: 0 });
  assert.deepEqual(state.folded, { a: false, b: false, c: false });
  assert.deepEqual(state.rerolled, { a: false, b: false, c: false });
  assert.deepEqual(state.round, {
    highest: 0,
    put: { a: 0, b: 0, c: 0 },
    raises: 0,
    acted: { a: false, b: false, c: false },
  });
  assert.equal(state.lastHand, null);
  assert.equal(state.winner, null);
  assert.equal(state.finished, false);
  assert.equal(poker.currentSeat(state), "a");
  assert.equal(poker.result(state), null);
  assert.equal(poker.publicView(state), state);
  assert.equal(poker.privateView(state, "a"), null);
});

test("партия целиком: ставки, переброс, вскрытие, смена сдающего, конец", async () => {
  let state = await setup(["a", "b"], {}, [[6, 6, 3, 2, 1], [5, 5, 4, 2, 1]]);
  let events;
  const ctx = makeScriptedCtx([[6, 4, 4], [1, 1, 2, 3, 4], [2, 2, 2, 3, 4]]);

  // первый круг ставок: чек, повышение, ответ
  ({ state, events } = await play(state, ctx, [["a", CHECK]]));
  assert.deepEqual(events, [{ type: "checked", seat: "a" }]);
  assert.equal(state.current, "b");
  assert.equal(state.round.acted.a, true);

  ({ state, events } = await play(state, ctx, [["b", BET]]));
  assert.deepEqual(events, [{ type: "bet", seat: "b", highest: 5 }]);
  assert.deepEqual(state.round, { highest: 5, put: { a: 0, b: 5 }, raises: 1, acted: { a: false, b: true } });
  assert.deepEqual(state.bets, { a: 0, b: 5 });
  assert.equal(state.current, "a");
  assert.equal(poker.validate(state, "a", CHECK), "cannotCheck");

  ({ state, events } = await play(state, ctx, [["a", CALL]]));
  assert.deepEqual(events, [{ type: "called", seat: "a", highest: 5 }]);
  assert.deepEqual(state.bets, { a: 5, b: 5 });
  assert.equal(state.phase, "reroll");
  assert.equal(state.current, "a");

  // переброс: по разу каждому
  ({ state, events } = await play(state, ctx, [["a", { type: "reroll", indices: [2, 3, 4] }]]));
  assert.deepEqual(events, [{ type: "rerolled", seat: "a", indices: [2, 3, 4], values: [6, 6, 6, 4, 4] }]);
  assert.deepEqual(state.dice.a, [6, 6, 6, 4, 4]);
  assert.deepEqual(state.rerolled, { a: true, b: false });
  assert.equal(state.current, "b");

  ({ state, events } = await play(state, ctx, [["b", KEEP]]));
  assert.deepEqual(events, [{ type: "rerolled", seat: "b", indices: [], values: [5, 5, 4, 2, 1] }]);
  assert.equal(state.phase, "bet2");
  assert.equal(state.current, "a");
  assert.deepEqual(state.round, { highest: 0, put: { a: 0, b: 0 }, raises: 0, acted: { a: false, b: false } });

  // второй круг ставок и вскрытие
  ({ state, events } = await play(state, ctx, [["a", BET], ["b", CALL]]));
  const hands = {
    a: { values: [6, 6, 6, 4, 4], rank: 6, name: "fullHouse" },
    b: { values: [5, 5, 4, 2, 1], rank: 1, name: "pair" },
  };
  assert.deepEqual(events, [
    { type: "bet", seat: "a", highest: 5 },
    { type: "called", seat: "b", highest: 5 },
    { type: "showdown", hands, winner: "a" },
    { type: "handWon", seat: "a", handNo: 1 },
    { type: "dealt", handNo: 2, hands: { a: [2, 2, 2, 3, 4], b: [1, 1, 2, 3, 4] } },
  ]);
  assert.deepEqual(state.lastHand, { winner: "a", hands, handNo: 1, byFold: false });
  assert.deepEqual(state.handWins, { a: 1, b: 0 });
  assert.deepEqual(state.bets, { a: 10, b: 10 });

  // новая раздача: сдающий сменился, всё сброшено
  assert.equal(state.handNo, 2);
  assert.equal(state.dealer, "b");
  assert.equal(state.current, "b");
  assert.equal(state.phase, "bet1");
  assert.deepEqual(state.rerolled, { a: false, b: false });
  assert.deepEqual(state.folded, { a: false, b: false });
  assert.deepEqual(state.round, { highest: 0, put: { a: 0, b: 0 }, raises: 0, acted: { a: false, b: false } });
  assert.equal(poker.result(state), null);

  ({ state, events } = await play(state, ctx, [["b", CHECK], ["a", CHECK], ["b", KEEP], ["a", KEEP], ["b", CHECK], ["a", CHECK]]));
  assert.deepEqual(types(events), ["checked", "checked", "rerolled", "rerolled", "checked", "checked", "showdown", "handWon", "won"]);
  assert.deepEqual(events.at(-2), { type: "handWon", seat: "a", handNo: 2 });
  assert.deepEqual(events.at(-1), { type: "won", seat: "a" });
  assert.equal(state.finished, true);
  assert.equal(state.winner, "a");
  assert.equal(state.current, null);
  assert.equal(poker.currentSeat(state), null);
  assert.deepEqual(poker.result(state), { winners: ["a"], scores: { a: 2, b: 0 }, extra: { a: 10, b: 10 }, leftBets: {} });
  assert.equal(ctx.remaining(), 0);
});

test("повышений в круге не больше maxRaises, перебивший доплачивает разницу", async () => {
  let state = await setup(["a", "b", "c"], { raise: 10, maxRaises: 2 }, [[6, 6, 3, 2, 1], [5, 5, 4, 2, 1], [1, 2, 3, 4, 6]]);
  ({ state } = await play(state, NO_ROLLS, [["a", BET], ["b", BET]]));
  assert.deepEqual(state.round, {
    highest: 20,
    put: { a: 10, b: 20, c: 0 },
    raises: 2,
    acted: { a: false, b: true, c: false },
  });
  assert.equal(poker.validate(state, "c", BET), "noRaises");
  assert.deepEqual(poker.legalActions(state, "c"), [CALL, FOLD]);
  ({ state } = await play(state, NO_ROLLS, [["c", CALL]]));
  // после повышения первому приходится отвечать заново
  assert.equal(state.phase, "bet1");
  assert.equal(state.current, "a");
  ({ state } = await play(state, NO_ROLLS, [["a", CALL]]));
  assert.deepEqual(state.bets, { a: 20, b: 20, c: 20 });
  assert.equal(state.phase, "reroll");
  assert.equal(state.current, "a");
});

test("все сбросили — оставшийся берёт раздачу без вскрытия", async () => {
  let state = await setup(["a", "b", "c"], {}, [[1, 2, 3, 4, 6], [5, 5, 4, 2, 1], [6, 6, 6, 6, 6]]);
  let events;
  const ctx = makeScriptedCtx([[1, 1, 1, 1, 2], [2, 2, 2, 2, 3], [3, 3, 3, 3, 4]]);
  ({ state, events } = await play(state, ctx, [["a", BET], ["b", FOLD]]));
  assert.deepEqual(events.at(-1), { type: "folded", seat: "b" });
  assert.equal(state.folded.b, true);
  assert.equal(state.current, "c");
  ({ state, events } = await play(state, ctx, [["c", FOLD]]));
  assert.deepEqual(events, [
    { type: "folded", seat: "c" },
    { type: "handWon", seat: "a", handNo: 1 },
    { type: "dealt", handNo: 2, hands: { b: [1, 1, 1, 1, 2], c: [2, 2, 2, 2, 3], a: [3, 3, 3, 3, 4] } },
  ]);
  assert.deepEqual(state.lastHand, {
    winner: "a",
    hands: { a: { values: [1, 2, 3, 4, 6], rank: 0, name: "nothing" } },
    handNo: 1,
    byFold: true,
  });
  assert.deepEqual(state.handWins, { a: 1, b: 0, c: 0 });
  assert.deepEqual(state.bets, { a: 5, b: 0, c: 0 });
  assert.deepEqual(state.folded, { a: false, b: false, c: false });
  assert.equal(state.dealer, "b");
  assert.equal(state.current, "b");
});

test("сбросивший пропускает переброс и вскрытие", async () => {
  // у «a» лучшая рука, но он сбросил
  let state = await setup(["a", "b", "c"], { handsToWin: 1 }, [[6, 6, 6, 6, 6], [5, 5, 4, 2, 1], [4, 4, 4, 2, 1]]);
  let events;
  ({ state } = await play(state, NO_ROLLS, [["a", CHECK], ["b", BET], ["c", CALL], ["a", FOLD]]));
  assert.equal(state.phase, "reroll");
  assert.equal(state.current, "b");
  assert.equal(poker.validate(state, "a", KEEP), "notYourTurn");
  ({ state } = await play(state, NO_ROLLS, [["b", KEEP], ["c", KEEP]]));
  assert.equal(state.phase, "bet2");
  assert.equal(state.current, "b");
  ({ state, events } = await play(state, NO_ROLLS, [["b", CHECK], ["c", CHECK]]));
  const showdown = events.find((e) => e.type === "showdown");
  assert.deepEqual(Object.keys(showdown.hands), ["b", "c"]);
  assert.equal(showdown.winner, "c");
  assert.deepEqual(poker.result(state), { winners: ["c"], scores: { a: 0, b: 0, c: 1 }, extra: { a: 0, b: 5, c: 5 }, leftBets: {} });
});

test("сброс в ответ на повышение во втором круге", async () => {
  let state = await setup(["a", "b"], {}, [[6, 6, 3, 2, 1], [5, 5, 4, 2, 1]]);
  let events;
  const ctx = makeScriptedCtx([[1, 1, 2, 3, 4], [2, 2, 2, 3, 4]]);
  ({ state, events } = await play(state, ctx, [["a", CHECK], ["b", CHECK], ["a", KEEP], ["b", KEEP], ["a", BET], ["b", BET], ["a", FOLD]]));
  assert.deepEqual(types(events).slice(-3), ["folded", "handWon", "dealt"]);
  assert.equal(state.lastHand.winner, "b");
  assert.equal(state.lastHand.byFold, true);
  // сброс отдаёт раздачу, но поставленное остаётся в банке
  assert.deepEqual(state.bets, { a: 5, b: 10 });
  assert.deepEqual(state.handWins, { a: 0, b: 1 });
});

test("ставки выключены: сразу переброс и вскрытие", async () => {
  let state = await setup(["a", "b"], { betting: false, handsToWin: 1 }, [[6, 6, 3, 2, 1], [5, 5, 4, 2, 1]]);
  let events;
  assert.equal(state.phase, "reroll");
  assert.equal(state.current, "a");
  for (const action of [CHECK, BET, CALL, FOLD]) assert.equal(poker.validate(state, "a", action), "wrongPhase");
  const ctx = makeScriptedCtx([[5]]);
  ({ state, events } = await play(state, ctx, [["a", KEEP], ["b", { type: "reroll", indices: [4] }]]));
  assert.deepEqual(types(events), ["rerolled", "rerolled", "showdown", "handWon", "won"]);
  assert.deepEqual(state.dice.b, [5, 5, 4, 2, 5]);
  assert.deepEqual(poker.result(state), { winners: ["b"], scores: { a: 0, b: 1 }, extra: { a: 0, b: 0 }, leftBets: {} });
});

test("равные лучшие руки — раздача ничья, никто не получает победу", async () => {
  let state = await setup(["a", "b", "c"], { betting: false, handsToWin: 1 }, [[3, 3, 5, 4, 1], [1, 3, 4, 3, 5], [2, 2, 6, 5, 4]]);
  let events;
  const ctx = makeScriptedCtx([[1, 1, 1, 1, 2], [2, 2, 2, 2, 3], [3, 3, 3, 3, 4]]);
  ({ state, events } = await play(state, ctx, [["a", KEEP], ["b", KEEP], ["c", KEEP]]));
  assert.deepEqual(types(events), ["rerolled", "rerolled", "rerolled", "showdown", "handDraw", "dealt"]);
  assert.equal(events[3].winner, null);
  assert.deepEqual(events[4], { type: "handDraw", handNo: 1 });
  assert.deepEqual(state.handWins, { a: 0, b: 0, c: 0 });
  assert.equal(state.lastHand.winner, null);
  assert.equal(state.handNo, 2);
  assert.equal(state.dealer, "b");
  assert.equal(state.current, "b");
  assert.equal(state.finished, false);
});

test("сдающий идёт по кругу", async () => {
  let state = await setup(["a", "b", "c"], { betting: false, handsToWin: 3 }, [[6, 6, 6, 6, 6], [1, 1, 2, 3, 4], [1, 1, 2, 3, 5]]);
  const hand = [[6, 6, 6, 6, 6], [1, 1, 2, 3, 4], [1, 1, 2, 3, 5]];
  const ctx = makeScriptedCtx([...hand, ...hand, ...hand]);
  const dealers = [state.dealer];
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 3; k++) ({ state } = await play(state, ctx, [[state.current, KEEP]]));
    dealers.push(state.dealer);
  }
  // покер шестёрок достаётся сдающему: a, потом b, потом c — трёх побед ни у кого
  assert.deepEqual(dealers, ["a", "b", "c", "a"]);
  assert.deepEqual(state.handWins, { a: 1, b: 1, c: 1 });
  assert.equal(state.handNo, 4);
});

test("проверка ходов: коды ошибок", async () => {
  let state = await setup(["a", "b"], { maxRaises: 1, handsToWin: 1 }, [[6, 6, 3, 2, 1], [5, 5, 4, 2, 1]]);
  assert.equal(poker.validate(state, "b", CHECK), "notYourTurn");
  assert.equal(poker.validate(state, "a", { type: "dance" }), "badAction");
  assert.equal(poker.validate(state, "a", null), "badAction");
  assert.equal(poker.validate(state, "a", KEEP), "wrongPhase");
  assert.equal(poker.validate(state, "a", CALL), "cannotCall");
  assert.equal(poker.validate(state, "a", CHECK), null);
  assert.equal(poker.validate(state, "a", BET), null);
  assert.equal(poker.validate(state, "a", FOLD), null);
  await assert.rejects(runAction(poker, state, "a", CALL, NO_ROLLS), (e) => e instanceof GameError && e.code === "cannotCall");

  ({ state } = await play(state, NO_ROLLS, [["a", BET]]));
  assert.equal(poker.validate(state, "b", CHECK), "cannotCheck");
  assert.equal(poker.validate(state, "b", BET), "noRaises");
  assert.equal(poker.validate(state, "b", CALL), null);

  ({ state } = await play(state, NO_ROLLS, [["b", CALL]]));
  assert.equal(state.phase, "reroll");
  assert.equal(poker.validate(state, "a", CHECK), "wrongPhase");
  assert.equal(poker.validate(state, "a", FOLD), "wrongPhase");
  for (const indices of [undefined, "01", [5], [-1], [0, 0], [1.5], ["1"], [0, 1, 2, 3, 4, 4]]) {
    assert.equal(poker.validate(state, "a", { type: "reroll", indices }), "badIndices", JSON.stringify(indices));
  }
  assert.equal(poker.validate(state, "a", { type: "reroll", indices: [4, 0, 2] }), null);
  assert.equal(poker.validate(state, "a", { type: "reroll", indices: [0, 1, 2, 3, 4] }), null);

  ({ state } = await play(state, NO_ROLLS, [["a", KEEP], ["b", KEEP], ["a", CHECK], ["b", CHECK]]));
  assert.equal(state.finished, true);
  assert.equal(poker.validate(state, "a", CHECK), "finished");
  assert.deepEqual(poker.legalActions(state, "a"), []);
});

test("перечень ходов: ставки и все 32 набора переброса", async () => {
  let state = await setup(["a", "b"], { maxRaises: 1 }, [[6, 6, 3, 2, 1], [5, 5, 4, 2, 1]]);
  assert.deepEqual(poker.legalActions(state, "a"), [CHECK, BET, FOLD]);
  assert.deepEqual(poker.legalActions(state, "b"), []);
  ({ state } = await play(state, NO_ROLLS, [["a", BET]]));
  assert.deepEqual(poker.legalActions(state, "b"), [CALL, FOLD]);
  ({ state } = await play(state, NO_ROLLS, [["b", CALL]]));
  const rerolls = poker.legalActions(state, "a");
  assert.equal(rerolls.length, 32);
  assert.equal(new Set(rerolls.map((a) => a.indices.join(""))).size, 32);
  assert.ok(rerolls.some((a) => a.indices.length === 0));
  for (const action of rerolls) assert.equal(poker.validate(state, "a", action), null);
});

test("apply и removeSeat не меняют входное состояние", async () => {
  const state = await setup(["a", "b", "c"], {}, [[6, 6, 3, 2, 1], [5, 5, 4, 2, 1], [1, 2, 3, 4, 6]]);
  const before = JSON.stringify(state);
  await poker.apply(state, "a", BET, NO_ROLLS);
  await poker.apply(state, "a", FOLD, NO_ROLLS);
  await poker.removeSeat(state, "a", NO_ROLLS);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(JSON.parse(before), state);
});

test("ушедший игрок: остался один — он и выиграл, вклад ушедшего сохранён", async () => {
  let state = await setup(["a", "b"], {}, [[6, 6, 3, 2, 1], [5, 5, 4, 2, 1]]);
  let events;
  ({ state } = await play(state, NO_ROLLS, [["a", BET]]));
  ({ state, events } = await poker.removeSeat(state, "a", NO_ROLLS));
  assert.deepEqual(events, [{ type: "left", seat: "a" }, { type: "won", seat: "b" }]);
  assert.equal(state.finished, true);
  assert.equal(state.current, null);
  assert.deepEqual(state.order, ["b"]);
  assert.deepEqual(state.leftBets, { a: 5 });
  assert.deepEqual(poker.result(state), { winners: ["b"], scores: { b: 0 }, extra: { b: 0 }, leftBets: { a: 5 } });
  // после конца партии уход ничего не меняет
  const after = await poker.removeSeat(state, "b", NO_ROLLS);
  assert.deepEqual(after.events, [{ type: "left", seat: "b" }]);
  assert.deepEqual(after.state, state);
});

test("ушёл текущий — ход и сдача переходят к следующему, место убрано отовсюду", async () => {
  let state = await setup(["a", "b", "c"], {}, [[6, 6, 3, 2, 1], [5, 5, 4, 2, 1], [1, 2, 3, 4, 6]]);
  let events;
  ({ state, events } = await poker.removeSeat(state, "a", NO_ROLLS));
  assert.deepEqual(events, [{ type: "left", seat: "a" }]);
  assert.deepEqual(state.order, ["b", "c"]);
  assert.equal(state.current, "b");
  assert.equal(state.dealer, "b");
  assert.equal(state.phase, "bet1");
  for (const map of [state.handWins, state.dice, state.folded, state.rerolled, state.bets, state.round.put, state.round.acted]) {
    assert.deepEqual(Object.keys(map), ["b", "c"]);
  }
  // незнакомое место — только событие
  const other = await poker.removeSeat(state, "zz", NO_ROLLS);
  assert.deepEqual(other.state, state);
});

test("ушёл не текущий — ход остаётся на месте", async () => {
  let state = await setup(["a", "b", "c"], {}, [[6, 6, 3, 2, 1], [5, 5, 4, 2, 1], [1, 2, 3, 4, 6]]);
  ({ state } = await poker.removeSeat(state, "b", NO_ROLLS));
  assert.equal(state.current, "a");
  assert.equal(state.dealer, "a");
  assert.deepEqual(state.order, ["a", "c"]);
  ({ state } = await play(state, NO_ROLLS, [["a", CHECK], ["c", CHECK]]));
  assert.equal(state.phase, "reroll");
});

test("ушёл последний в круге ставок — игра идёт к перебросу", async () => {
  let state = await setup(["a", "b", "c"], {}, [[6, 6, 3, 2, 1], [5, 5, 4, 2, 1], [1, 2, 3, 4, 6]]);
  ({ state } = await play(state, NO_ROLLS, [["a", CHECK], ["b", CHECK]]));
  ({ state } = await poker.removeSeat(state, "c", NO_ROLLS));
  assert.equal(state.phase, "reroll");
  assert.equal(state.current, "a");
});

test("ушёл последний в перебросе — вскрытие и новая раздача", async () => {
  let state = await setup(["a", "b", "c"], { betting: false }, [[6, 6, 3, 2, 1], [5, 5, 4, 2, 1], [6, 6, 6, 6, 6]]);
  let events;
  ({ state } = await play(state, NO_ROLLS, [["a", KEEP], ["b", KEEP]]));
  const ctx = makeScriptedCtx([[1, 1, 2, 3, 4], [2, 2, 2, 3, 4]]);
  ({ state, events } = await poker.removeSeat(state, "c", ctx));
  assert.deepEqual(types(events), ["left", "showdown", "handWon", "dealt"]);
  assert.deepEqual(Object.keys(events[1].hands), ["a", "b"]);
  assert.deepEqual(state.handWins, { a: 1, b: 0 });
  assert.equal(state.handNo, 2);
  assert.equal(state.dealer, "b");
  assert.deepEqual(state.dice, { b: [1, 1, 2, 3, 4], a: [2, 2, 2, 3, 4] });
  assert.equal(ctx.remaining(), 0);
});

test("ушёл — и в раздаче остался один несбросивший: раздача его", async () => {
  let state = await setup(["a", "b", "c"], {}, [[6, 6, 3, 2, 1], [5, 5, 4, 2, 1], [1, 2, 3, 4, 6]]);
  let events;
  ({ state } = await play(state, NO_ROLLS, [["a", BET], ["b", FOLD]]));
  const ctx = makeScriptedCtx([[1, 1, 2, 3, 4], [2, 2, 2, 3, 4]]);
  ({ state, events } = await poker.removeSeat(state, "c", ctx));
  assert.deepEqual(types(events), ["left", "handWon", "dealt"]);
  assert.equal(state.lastHand.winner, "a");
  assert.equal(state.lastHand.byFold, true);
  assert.deepEqual(state.handWins, { a: 1, b: 0 });
  assert.deepEqual(state.folded, { a: false, b: false });
  assert.equal(state.current, "b");
});

test("ушёл повысивший — отвечать на его ставку не нужно", async () => {
  let state = await setup(["a", "b", "c"], {}, [[6, 6, 3, 2, 1], [5, 5, 4, 2, 1], [1, 2, 3, 4, 6]]);
  ({ state } = await play(state, NO_ROLLS, [["a", BET]]));
  let left = (await poker.removeSeat(state, "a", NO_ROLLS)).state;
  assert.equal(left.round.highest, 0);
  assert.equal(left.current, "b");
  assert.equal(poker.validate(left, "b", CHECK), null);
  assert.deepEqual(left.leftBets, { a: 5 });

  // если кто-то уже ответил — уровень остаётся по нему
  ({ state } = await play(state, NO_ROLLS, [["b", CALL]]));
  left = (await poker.removeSeat(state, "a", NO_ROLLS)).state;
  assert.equal(left.round.highest, 5);
  assert.equal(left.current, "c");
  assert.equal(poker.validate(left, "c", CHECK), "cannotCheck");
  ({ state: left } = await play(left, NO_ROLLS, [["c", CALL]]));
  assert.equal(left.phase, "reroll");
  assert.equal(left.current, "b");
  assert.deepEqual(left.bets, { b: 5, c: 5 });
});

test("бот: верная рука повышает, проигранная сбрасывает, переброс по делу", async () => {
  const calm = { greed: 1, skill: 1, bluff: 0 };
  const rng = mulberry32(7);
  let state = await setup(["a", "b"], {}, [[6, 6, 6, 6, 2], [1, 1, 1, 1, 1]]);
  ({ state } = await play(state, NO_ROLLS, [["a", CHECK], ["b", CHECK]]));

  // побить покер единиц можно только покером шестёрок — перебрасывается одна кость
  assert.deepEqual(bot({ view: state, mine: null, seatId: "a", options: state.rules, temperament: calm, rng }), {
    type: "reroll",
    indices: [4],
  });
  ({ state } = await play(state, makeScriptedCtx([[3]]), [["a", { type: "reroll", indices: [4] }]]));
  // покер уже старше каре соперника — оставить всё
  assert.deepEqual(bot({ view: state, mine: null, seatId: "b", options: state.rules, temperament: calm, rng }), KEEP);
  ({ state } = await play(state, NO_ROLLS, [["b", KEEP]]));

  assert.equal(state.phase, "bet2");
  assert.deepEqual(bot({ view: state, mine: null, seatId: "a", options: state.rules, temperament: calm, rng }), CHECK);
  ({ state } = await play(state, NO_ROLLS, [["a", CHECK]]));
  assert.deepEqual(bot({ view: state, mine: null, seatId: "b", options: state.rules, temperament: calm, rng }), BET);
  ({ state } = await play(state, NO_ROLLS, [["b", BET]]));
  assert.deepEqual(bot({ view: state, mine: null, seatId: "a", options: state.rules, temperament: calm, rng }), FOLD);
});

test("боты доигрывают 720 партий без недопустимых ходов", async () => {
  const phases = ["bet1", "reroll", "bet2"];
  let hands = 0;
  let folds = 0;
  for (let seed = 1; seed <= 720; seed++) {
    const seats = 2 + (seed % 3);
    const options = {
      betting: seed % 2 === 0,
      handsToWin: 1 + (seed % 3),
      raise: 1 + (seed % 7),
      maxRaises: 1 + (seed % 4),
    };
    const { state, result, events, seatIds } = await simulate(poker, bot, {
      seats,
      options,
      seed,
      onStep({ state: s }) {
        assert.ok(phases.includes(s.phase));
        if (!s.finished) assert.equal(s.folded[s.current], false);
        for (const id of s.order) {
          assert.equal(s.dice[id].length, 5);
          assert.ok(s.dice[id].every((v) => Number.isInteger(v) && v >= 1 && v <= 6));
        }
      },
    });
    assert.equal(result.winners.length, 1);
    const [winner] = result.winners;
    assert.equal(state.winner, winner);
    assert.equal(result.scores[winner], state.rules.handsToWin);
    for (const id of seatIds) {
      if (id !== winner) assert.ok(result.scores[id] < state.rules.handsToWin);
      assert.ok(result.extra[id] >= 0);
      assert.equal(result.extra[id] % state.rules.raise, 0);
      if (!options.betting) assert.equal(result.extra[id], 0);
    }
    // побед в раздачах столько же, сколько событий handWon
    const won = events.filter((e) => e.type === "handWon");
    assert.equal(won.length, Object.values(result.scores).reduce((a, b) => a + b, 0));
    assert.equal(events.filter((e) => e.type === "won").length, 1);
    if (!options.betting) assert.ok(!events.some((e) => ["checked", "bet", "called", "folded"].includes(e.type)));
    hands += state.handNo;
    folds += events.filter((e) => e.type === "folded").length;
  }
  // партии не вырождаются: раздач больше, чем партий, и сбросы случаются
  assert.ok(hands > 720);
  assert.ok(folds > 0);
});
