import assert from "node:assert/strict";
import { test } from "node:test";

import bot from "../scripts/core/bots/liars.mjs";
import { makeScriptedCtx } from "../scripts/core/engine.mjs";
import liars, { allowedFaces, bidProbability, countMatches, isHigherBid } from "../scripts/core/games/liars.mjs";
import { simulate } from "./helpers/sim.mjs";

/** Заданные броски + запись того, как игра просила их бросить. */
function recordingCtx(queue) {
  const inner = makeScriptedCtx(queue);
  const calls = [];
  return {
    ...inner,
    calls,
    async roll(dice, opts) {
      calls.push({ dice, opts });
      return inner.roll(dice);
    },
  };
}

const setup = (cups, options = {}, seatIds = ["a", "b", "c", "d", "e", "f"].slice(0, cups.length)) =>
  liars.setup({ seatIds, options: liars.normalizeOptions({ dice: cups[0].length, ...options }), ctx: makeScriptedCtx(cups) });

const noCtx = () => makeScriptedCtx([]);

const bid = (q, f) => ({ type: "bid", q, f });

/** Есть ли где-нибудь внутри значения массив (стаканчик) или ключ cup/cups. */
function leaksCups(value) {
  if (Array.isArray(value)) return true;
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, v]) => key === "cups" || key === "cup" || leaksCups(v));
}

test("allowedFaces: с джокерами на единицы не ставят", () => {
  assert.deepEqual(allowedFaces({ onesWild: true }), [2, 3, 4, 5, 6]);
  assert.deepEqual(allowedFaces({ onesWild: false }), [1, 2, 3, 4, 5, 6]);
});

test("isHigherBid: больше костей или та же ставка старшей гранью", () => {
  assert.equal(isHigherBid(null, 1, 2), true);
  const prev = { seat: "a", q: 3, f: 4 };
  assert.equal(isHigherBid(prev, 4, 2), true);
  assert.equal(isHigherBid(prev, 3, 5), true);
  assert.equal(isHigherBid(prev, 3, 4), false);
  assert.equal(isHigherBid(prev, 3, 3), false);
  assert.equal(isHigherBid(prev, 2, 6), false);
});

test("countMatches: единицы — джокеры только если включено", () => {
  const cups = { a: [1, 2, 2, 5], b: [1, 1, 5, 6] };
  assert.equal(countMatches(cups, 2, true), 5);
  assert.equal(countMatches(cups, 2, false), 2);
  assert.equal(countMatches(cups, 5, true), 5);
  assert.equal(countMatches(cups, 1, false), 3);
  assert.equal(countMatches(cups, 1, true), 3);
  assert.equal(countMatches(cups, 4, false), 0);
  assert.equal(countMatches({}, 3, true), 0);
});

test("bidProbability: своих костей хватает — 1; убывает с ростом q", () => {
  const cup = [1, 3, 3, 5, 6];
  assert.equal(bidProbability(3, 3, cup, 10, true), 1);
  assert.equal(bidProbability(2, 3, cup, 10, false), 1);
  assert.equal(bidProbability(3, 3, cup, 0, false), 0);
  assert.equal(bidProbability(14, 3, cup, 10, true), 0);
  // одна чужая кость: тройка или единица — 1/3, без джокеров — 1/6
  assert.ok(Math.abs(bidProbability(4, 3, cup, 1, true) - 1 / 3) < 1e-12);
  assert.ok(Math.abs(bidProbability(3, 3, cup, 1, false) - 1 / 6) < 1e-12);
  // две чужие кости, нужна хотя бы одна шестёрка: 1 − (5/6)²
  assert.ok(Math.abs(bidProbability(2, 6, [6, 2], 2, false) - 11 / 36) < 1e-12);
  for (const wild of [true, false]) {
    for (const f of allowedFaces({ onesWild: wild })) {
      let prev = 1;
      for (let q = 1; q <= 20; q++) {
        const p = bidProbability(q, f, cup, 12, wild);
        assert.ok(p >= 0 && p <= 1);
        assert.ok(p <= prev + 1e-12, `q=${q} f=${f}`);
        prev = p;
      }
      assert.equal(prev, 0);
    }
  }
});

test("настройки приводятся к границам", () => {
  assert.deepEqual(liars.normalizeOptions({}), { dice: 5, onesWild: true, spotOn: true });
  assert.deepEqual(liars.normalizeOptions({ dice: 9, onesWild: false, spotOn: "x" }), { dice: 6, onesWild: false, spotOn: true });
  assert.equal(liars.normalizeOptions({ dice: 1 }).dice, 3);
});

test("раздача: каждому свой тайный бросок", async () => {
  const ctx = recordingCtx([[1, 2, 3, 4, 5], [6, 6, 6, 6, 6], [2, 2, 3, 3, 4]]);
  const state = await liars.setup({ seatIds: ["a", "b", "c"], options: liars.normalizeOptions({}), ctx });
  assert.equal(ctx.calls.length, 3);
  assert.deepEqual(ctx.calls.map((c) => c.opts), ["a", "b", "c"].map((seat) => ({ seat, secret: true, reason: "liars" })));
  for (const c of ctx.calls) assert.deepEqual(c.dice, [{ sides: 6, count: 5 }]);
  assert.deepEqual(state, {
    order: ["a", "b", "c"],
    rules: { dice: 5, onesWild: true, spotOn: true },
    counts: { a: 5, b: 5, c: 5 },
    cups: { a: [1, 2, 3, 4, 5], b: [6, 6, 6, 6, 6], c: [2, 2, 3, 3, 4] },
    round: 1,
    starter: "a",
    current: "a",
    phase: "bidding",
    bid: null,
    history: [],
    reveal: null,
    winner: null,
    finished: false,
  });
  assert.equal(liars.currentSeat(state), "a");
  assert.equal(liars.result(state), null);
});

test("виды: общий — без стаканчиков, личный — только свой", async () => {
  const state = await setup([[1, 2, 3], [4, 5, 6]]);
  const view = liars.publicView(state);
  assert.equal("cups" in view, false);
  assert.equal(JSON.stringify(view).includes("cups"), false);
  assert.equal(view.totalDice, 6);
  assert.deepEqual(view.counts, { a: 3, b: 3 });
  view.counts.a = 0;
  view.history.push("x");
  assert.equal(state.counts.a, 3);
  assert.deepEqual(state.history, []);
  assert.deepEqual(liars.privateView(state, "a"), { cup: [1, 2, 3] });
  assert.deepEqual(liars.privateView(state, "b"), { cup: [4, 5, 6] });
  assert.equal(liars.privateView(state, "zzz"), null);
  liars.privateView(state, "a").cup.push(6);
  assert.deepEqual(state.cups.a, [1, 2, 3]);
});

test("ставки: только выше прежней, ход идёт по кругу", async () => {
  let state = await setup([[2, 2, 3], [4, 5, 6], [3, 3, 3]]);
  let events;
  ({ state, events } = await liars.apply(state, "a", bid(2, 3), noCtx()));
  assert.deepEqual(events, [{ type: "bid", seat: "a", q: 2, f: 3 }]);
  assert.deepEqual(state.bid, { seat: "a", q: 2, f: 3 });
  assert.equal(state.current, "b");

  assert.equal(liars.validate(state, "b", bid(2, 3)), "lowBid");
  assert.equal(liars.validate(state, "b", bid(2, 2)), "lowBid");
  assert.equal(liars.validate(state, "b", bid(1, 6)), "lowBid");
  assert.equal(liars.validate(state, "b", bid(2, 4)), null);
  assert.equal(liars.validate(state, "b", bid(3, 2)), null);
  assert.equal(liars.validate(state, "b", bid(9, 2)), null);
  assert.equal(liars.validate(state, "b", bid(3, 1)), "badFace");
  assert.equal(liars.validate(state, "b", bid(3, 7)), "badFace");
  assert.equal(liars.validate(state, "b", bid(3, "4")), "badFace");
  assert.equal(liars.validate(state, "b", bid(10, 2)), "badQuantity");
  assert.equal(liars.validate(state, "b", bid(0, 2)), "badQuantity");
  assert.equal(liars.validate(state, "b", bid(2.5, 4)), "badQuantity");
  assert.equal(liars.validate(state, "b", bid("3", 4)), "badQuantity");

  ({ state } = await liars.apply(state, "b", bid(2, 4), noCtx()));
  ({ state } = await liars.apply(state, "c", bid(3, 3), noCtx()));
  assert.equal(state.current, "a");
  assert.deepEqual(state.history, [
    { seat: "a", q: 2, f: 3 },
    { seat: "b", q: 2, f: 4 },
    { seat: "c", q: 3, f: 3 },
  ]);
  assert.deepEqual(state.bid, { seat: "c", q: 3, f: 3 });
});

test("без джокеров на единицы ставить можно", async () => {
  const state = await setup([[1, 1, 3], [4, 5, 6]], { onesWild: false });
  assert.equal(liars.validate(state, "a", bid(2, 1)), null);
  assert.equal(liars.legalActions(state, "a").length, 6 * 6);
});

test("legalActions: все ставки выше текущей и вскрытия, каждая проходит validate", async () => {
  let state = await setup([[2, 2, 3], [4, 5, 6]]);
  const opening = liars.legalActions(state, "a");
  assert.equal(opening.length, 6 * 5);
  assert.equal(opening.some((a) => a.type !== "bid"), false);
  assert.deepEqual(liars.legalActions(state, "b"), []);

  ({ state } = await liars.apply(state, "a", bid(5, 4), noCtx()));
  const legal = liars.legalActions(state, "b");
  assert.deepEqual(legal.slice(0, 2), [{ type: "challenge" }, { type: "spotOn" }]);
  // 5×5, 5×6 и пять граней по шесть костей
  assert.equal(legal.length, 2 + 2 + 5);
  for (const action of legal) assert.equal(liars.validate(state, "b", action), null);

  ({ state } = await liars.apply(state, "b", bid(6, 6), noCtx()));
  assert.deepEqual(liars.legalActions(state, "a"), [{ type: "challenge" }, { type: "spotOn" }]);
  ({ state } = await liars.apply(state, "a", { type: "challenge" }, noCtx()));
  assert.deepEqual(liars.legalActions(state, state.current), [{ type: "next" }]);
});

test("«Не верю!»: ставка не набралась — кость теряет ставивший", async () => {
  let state = await setup([[2, 2, 3], [4, 5, 6]]);
  let events;
  ({ state } = await liars.apply(state, "a", bid(3, 2), noCtx()));
  ({ state, events } = await liars.apply(state, "b", { type: "challenge" }, noCtx()));
  const shown = {
    cups: { a: [2, 2, 3], b: [4, 5, 6] },
    bid: { seat: "a", q: 3, f: 2 },
    call: "challenge",
    caller: "b",
    actual: 2,
    loser: "a",
    gainer: null,
  };
  assert.deepEqual(events, [
    { type: "challenge", seat: "b", bid: { seat: "a", q: 3, f: 2 } },
    { type: "revealed", ...shown },
  ]);
  assert.deepEqual(state.reveal, shown);
  assert.deepEqual(state.counts, { a: 2, b: 3 });
  assert.equal(state.phase, "reveal");
  assert.equal(state.current, "a");
  assert.equal(liars.publicView(state).totalDice, 5);
  assert.deepEqual(liars.publicView(state).reveal.cups, shown.cups);
});

test("«Не верю!»: ставка набралась — кость теряет вскрывший; джокеры в счёт", async () => {
  let state = await setup([[2, 1, 3], [1, 5, 6]]);
  ({ state } = await liars.apply(state, "a", bid(3, 2), noCtx()));
  ({ state } = await liars.apply(state, "b", { type: "challenge" }, noCtx()));
  assert.equal(state.reveal.actual, 3);
  assert.equal(state.reveal.loser, "b");
  assert.deepEqual(state.counts, { a: 3, b: 2 });
  assert.equal(state.current, "b");

  // те же кости без джокеров — двойка одна, ставка ложная
  let plain = await setup([[2, 1, 3], [1, 5, 6]], { onesWild: false });
  ({ state: plain } = await liars.apply(plain, "a", bid(3, 2), noCtx()));
  ({ state: plain } = await liars.apply(plain, "b", { type: "challenge" }, noCtx()));
  assert.equal(plain.reveal.actual, 1);
  assert.equal(plain.reveal.loser, "a");
  assert.deepEqual(plain.counts, { a: 2, b: 3 });
});

test("«В точку!»: верно — кость возвращается, но не сверх стартовых; неверно — теряется", async () => {
  let state = await setup([[2, 2, 3], [4, 5, 6]]);
  let events;
  // круг 1: b не верит правдивой ставке и теряет кость
  ({ state } = await liars.apply(state, "a", bid(1, 2), noCtx()));
  ({ state } = await liars.apply(state, "b", { type: "challenge" }, noCtx()));
  assert.deepEqual(state.counts, { a: 3, b: 2 });

  // круг 2: a попадает в точку, но костей у него и так полный стаканчик
  ({ state } = await liars.apply(state, "b", { type: "next" }, makeScriptedCtx([[2, 3, 4], [5, 6]])));
  ({ state } = await liars.apply(state, "b", bid(1, 5), noCtx()));
  ({ state, events } = await liars.apply(state, "a", { type: "spotOn" }, noCtx()));
  assert.deepEqual(events[0], { type: "spotOn", seat: "a", bid: { seat: "b", q: 1, f: 5 } });
  assert.equal(events[1].type, "revealed");
  assert.equal(state.reveal.call, "spotOn");
  assert.equal(state.reveal.actual, 1);
  assert.equal(state.reveal.loser, null);
  assert.equal(state.reveal.gainer, null);
  assert.deepEqual(state.counts, { a: 3, b: 2 });
  assert.equal(state.current, "a");

  // круг 3: b попадает в точку и возвращает кость
  ({ state } = await liars.apply(state, "a", { type: "next" }, makeScriptedCtx([[2, 2, 2], [3, 3]])));
  ({ state } = await liars.apply(state, "a", bid(2, 3), noCtx()));
  ({ state } = await liars.apply(state, "b", { type: "spotOn" }, noCtx()));
  assert.equal(state.reveal.gainer, "b");
  assert.equal(state.reveal.loser, null);
  assert.deepEqual(state.counts, { a: 3, b: 3 });
  assert.equal(state.current, "b");

  // круг 4: a промахивается — костей больше, чем в ставке
  ({ state } = await liars.apply(state, "b", { type: "next" }, makeScriptedCtx([[4, 4, 4], [4, 4, 5]])));
  ({ state } = await liars.apply(state, "b", bid(4, 4), noCtx()));
  ({ state } = await liars.apply(state, "a", { type: "spotOn" }, noCtx()));
  assert.equal(state.reveal.actual, 5);
  assert.equal(state.reveal.loser, "a");
  assert.equal(state.reveal.gainer, null);
  assert.deepEqual(state.counts, { a: 2, b: 3 });
  assert.equal(state.current, "a");
  assert.equal(state.round, 4);
});

test("«В точку!» выключено настройкой", async () => {
  let state = await setup([[2, 2, 3], [4, 5, 6]], { spotOn: false });
  assert.equal(liars.validate(state, "a", { type: "spotOn" }), "spotOnOff");
  ({ state } = await liars.apply(state, "a", bid(1, 2), noCtx()));
  assert.equal(liars.validate(state, "b", { type: "spotOn" }), "spotOnOff");
  assert.equal(liars.legalActions(state, "b").some((a) => a.type === "spotOn"), false);
  assert.equal(liars.legalActions(state, "b").some((a) => a.type === "challenge"), true);
});

test("без костей — выбыл: его пропускают и костей ему не бросают", async () => {
  let state = await setup([[2, 2, 3], [4, 5, 6], [3, 3, 3]]);
  let events;
  state.counts.b = 1;
  state.cups.b = [5];
  ({ state } = await liars.apply(state, "a", bid(2, 2), noCtx()));
  ({ state, events } = await liars.apply(state, "b", { type: "challenge" }, noCtx()));
  assert.deepEqual(events.at(-1), { type: "out", seat: "b" });
  assert.equal(state.counts.b, 0);
  assert.equal(state.finished, false);
  assert.equal(state.phase, "reveal");
  // выбывший круг не открывает — следующий за ним
  assert.equal(state.current, "c");
  assert.equal(liars.privateView(state, "b"), null);

  const ctx = recordingCtx([[2, 3, 4], [5, 5, 6]]);
  ({ state, events } = await liars.apply(state, "c", { type: "next" }, ctx));
  assert.equal(ctx.remaining(), 0);
  assert.deepEqual(ctx.calls.map((c) => c.opts.seat), ["a", "c"]);
  assert.equal(ctx.calls.every((c) => c.opts.secret === true), true);
  assert.deepEqual(state.cups, { a: [2, 3, 4], c: [5, 5, 6] });
  assert.deepEqual(events, [{ type: "round", round: 2, starter: "c" }]);
  assert.equal(liars.privateView(state, "b"), null);
  assert.equal(liars.publicView(state).totalDice, 6);
  assert.equal(liars.validate(state, "c", bid(7, 2)), "badQuantity");

  ({ state } = await liars.apply(state, "c", bid(1, 5), noCtx()));
  assert.equal(state.current, "a");
  ({ state } = await liars.apply(state, "a", bid(2, 5), noCtx()));
  assert.equal(state.current, "c");
  assert.equal(liars.validate(state, "b", bid(3, 5)), "notYourTurn");
});

test("после вскрытия нужен «next» от открывающего; reveal живёт до первой ставки", async () => {
  let state = await setup([[2, 2, 3], [4, 5, 6], [3, 3, 3]]);
  let events;
  assert.equal(liars.validate(state, "a", { type: "next" }), "wrongPhase");
  ({ state } = await liars.apply(state, "a", bid(1, 2), noCtx()));
  ({ state } = await liars.apply(state, "b", bid(6, 6), noCtx()));
  ({ state } = await liars.apply(state, "c", { type: "challenge" }, noCtx()));
  assert.equal(state.phase, "reveal");
  assert.equal(state.current, "b");
  assert.equal(state.starter, "a");
  assert.equal(liars.currentSeat(state), "b");
  assert.equal(liars.validate(state, "b", bid(1, 2)), "wrongPhase");
  assert.equal(liars.validate(state, "b", { type: "challenge" }), "wrongPhase");
  assert.equal(liars.validate(state, "b", { type: "spotOn" }), "wrongPhase");
  assert.equal(liars.validate(state, "a", { type: "next" }), "notYourTurn");
  assert.equal(liars.validate(state, "c", { type: "next" }), "notYourTurn");
  assert.equal(liars.validate(state, "b", { type: "next" }), null);
  const shown = structuredClone(state.reveal);

  const ctx = makeScriptedCtx([[6, 6, 6], [1, 1], [2, 3, 4]]);
  ({ state, events } = await liars.apply(state, "b", { type: "next" }, ctx));
  assert.equal(ctx.remaining(), 0);
  assert.deepEqual(events, [{ type: "round", round: 2, starter: "b" }]);
  assert.equal(state.round, 2);
  assert.equal(state.starter, "b");
  assert.equal(state.current, "b");
  assert.equal(state.phase, "bidding");
  assert.equal(state.bid, null);
  assert.deepEqual(state.history, []);
  assert.deepEqual(state.cups, { a: [6, 6, 6], b: [1, 1], c: [2, 3, 4] });
  // открытое прошлого круга ещё на столе, новых костей в нём нет
  assert.deepEqual(state.reveal, shown);
  assert.deepEqual(liars.publicView(state).reveal.cups, { a: [2, 2, 3], b: [4, 5, 6], c: [3, 3, 3] });
  assert.equal(liars.validate(state, "b", { type: "challenge" }), "noBid");

  ({ state } = await liars.apply(state, "b", bid(1, 3), noCtx()));
  assert.equal(state.reveal, null);
  assert.equal(JSON.stringify(liars.publicView(state)).includes("cups"), false);
  assert.equal(state.current, "c");
});

test("последний с костями забирает партию", async () => {
  let state = await setup([[2, 2, 3], [4, 5, 6]]);
  let events;
  state.counts.b = 1;
  state.cups.b = [6];
  ({ state } = await liars.apply(state, "a", bid(2, 2), noCtx()));
  ({ state, events } = await liars.apply(state, "b", { type: "challenge" }, noCtx()));
  assert.deepEqual(events.slice(-2), [
    { type: "out", seat: "b" },
    { type: "won", seat: "a" },
  ]);
  assert.equal(state.finished, true);
  assert.equal(state.winner, "a");
  assert.equal(state.current, null);
  assert.equal(state.phase, "reveal");
  assert.equal(liars.currentSeat(state), null);
  assert.deepEqual(liars.result(state), { winners: ["a"], scores: { a: 3, b: 0 } });
  assert.equal(liars.validate(state, "a", { type: "next" }), "finished");
  assert.deepEqual(liars.legalActions(state, "a"), []);
});

test("validate: коды ошибок", async () => {
  let state = await setup([[2, 2, 3], [4, 5, 6]]);
  assert.equal(liars.validate(state, "b", bid(1, 2)), "notYourTurn");
  assert.equal(liars.validate(state, "a", { type: "roll" }), "badAction");
  assert.equal(liars.validate(state, "a", null), "badAction");
  assert.equal(liars.validate(state, "a", { type: "challenge" }), "noBid");
  assert.equal(liars.validate(state, "a", { type: "spotOn" }), "noBid");
  assert.equal(liars.validate(state, "a", { type: "next" }), "wrongPhase");
  ({ state } = await liars.apply(state, "a", bid(2, 2), noCtx()));
  assert.equal(liars.validate(state, "b", { type: "challenge" }), null);
  assert.equal(liars.validate(state, "b", { type: "spotOn" }), null);
  // свою ставку вскрыть нельзя
  const own = { ...state, current: "a" };
  assert.equal(liars.validate(own, "a", { type: "challenge" }), "ownBid");
  assert.equal(liars.validate(own, "a", { type: "spotOn" }), "ownBid");
  assert.equal(liars.legalActions(own, "a").some((a) => a.type !== "bid"), false);
  assert.equal(liars.validate({ ...state, finished: true }, "b", bid(3, 2)), "finished");
});

test("apply и removeSeat не меняют входное состояние", async () => {
  let state = await setup([[2, 2, 3], [4, 5, 6], [3, 3, 3]]);
  const check = async (fn) => {
    const before = JSON.stringify(state);
    const res = await fn();
    assert.equal(JSON.stringify(state), before);
    return res.state;
  };
  await check(() => liars.removeSeat(state, "a", noCtx()));
  state = await check(() => liars.apply(state, "a", bid(4, 3), noCtx()));
  await check(() => liars.removeSeat(state, "b", noCtx()));
  state = await check(() => liars.apply(state, "b", { type: "challenge" }, noCtx()));
  await check(() => liars.removeSeat(state, "b", noCtx()));
  state = await check(() => liars.apply(state, "b", { type: "next" }, makeScriptedCtx([[1, 1, 1], [2, 2], [3, 3, 3]])));
  assert.equal(state.round, 2);
});

test("ушедший игрок: остался один — он и выиграл", async () => {
  const state = await setup([[2, 2, 3], [4, 5, 6]]);
  const { state: after, events } = await liars.removeSeat(state, "a", noCtx());
  assert.deepEqual(events, [
    { type: "left", seat: "a" },
    { type: "won", seat: "b" },
  ]);
  assert.deepEqual(after.order, ["b"]);
  assert.deepEqual(after.counts, { b: 3 });
  assert.deepEqual(after.cups, { b: [4, 5, 6] });
  assert.equal(after.current, null);
  assert.deepEqual(liars.result(after), { winners: ["b"], scores: { b: 3 } });
});

test("ушёл текущий — ход переходит к следующему с костями", async () => {
  let state = await setup([[2, 2, 3], [4, 5, 6], [3, 3, 3], [1, 1, 1]]);
  state.counts.c = 0;
  delete state.cups.c;
  ({ state } = await liars.apply(state, "a", bid(1, 2), noCtx()));
  const { state: after, events } = await liars.removeSeat(state, "b", noCtx());
  assert.deepEqual(events, [{ type: "left", seat: "b" }]);
  assert.equal(after.current, "d");
  assert.deepEqual(after.order, ["a", "c", "d"]);
  assert.deepEqual(after.counts, { a: 3, c: 0, d: 3 });
  assert.equal("b" in after.cups, false);
  assert.equal(liars.publicView(after).totalDice, 6);

  // ушёл не текущий — очередь не сдвигается
  const { state: other } = await liars.removeSeat(state, "d", noCtx());
  assert.equal(other.current, "b");
  // выбывший ушёл, а с костями осталось двое — игра идёт
  const { state: noC } = await liars.removeSeat(other, "c", noCtx());
  assert.equal(noC.finished, false);
  assert.deepEqual(noC.order, ["a", "b"]);
  // с костями остался один — победа, даже если за столом сидит выбывший
  const { state: done, events: doneEvents } = await liars.removeSeat(other, "b", noCtx());
  assert.equal(done.winner, "a");
  assert.deepEqual(doneEvents.at(-1), { type: "won", seat: "a" });
});

test("ушёл ставивший — ставка остаётся, а кость за него никто не теряет", async () => {
  let state = await setup([[2, 2, 3], [4, 5, 6], [3, 3, 3]]);
  ({ state } = await liars.apply(state, "a", bid(3, 6), noCtx()));
  ({ state } = await liars.removeSeat(state, "a", noCtx()));
  assert.deepEqual(state.bid, { seat: "a", q: 3, f: 6 });
  assert.deepEqual(state.history, [{ seat: "a", q: 3, f: 6 }]);
  assert.equal(state.current, "b");
  assert.equal(liars.validate(state, "b", { type: "challenge" }), null);
  assert.equal(liars.validate(state, "b", bid(4, 2)), null);

  const lie = await liars.apply(state, "b", { type: "challenge" }, noCtx());
  assert.equal(lie.state.reveal.actual, 1);
  assert.equal(lie.state.reveal.loser, null);
  assert.deepEqual(lie.state.counts, { b: 3, c: 3 });
  assert.equal(lie.state.current, "b");
  assert.equal(liars.validate(lie.state, "b", { type: "next" }), null);

  // правдивую ставку ушедшего вскрывать всё так же больно
  const truth = await liars.apply({ ...state, bid: { seat: "a", q: 1, f: 6 } }, "b", { type: "challenge" }, noCtx());
  assert.equal(truth.state.reveal.loser, "b");
  assert.deepEqual(truth.state.counts, { b: 2, c: 3 });
});

test("ушёл открывающий в фазе вскрытия — «next» жмёт следующий", async () => {
  let state = await setup([[2, 2, 3], [4, 5, 6], [3, 3, 3]]);
  ({ state } = await liars.apply(state, "a", bid(1, 2), noCtx()));
  ({ state } = await liars.apply(state, "b", { type: "challenge" }, noCtx()));
  assert.equal(state.current, "b");
  ({ state } = await liars.removeSeat(state, "b", noCtx()));
  assert.equal(state.phase, "reveal");
  assert.equal(state.current, "c");
  ({ state } = await liars.apply(state, "c", { type: "next" }, makeScriptedCtx([[1, 2, 3], [4, 5, 6]])));
  assert.equal(state.starter, "c");
  assert.deepEqual(Object.keys(state.cups), ["a", "c"]);
});

test("бот: в фазе вскрытия жмёт «next», иначе всегда допустимый ход", async () => {
  let state = await setup([[2, 2, 3], [4, 5, 6]]);
  const temperament = { greed: 1, skill: 1, bluff: 0 };
  const ask = (seatId) =>
    bot({ view: liars.publicView(state), mine: liars.privateView(state, seatId), seatId, options: state.rules, temperament, rng: () => 0.9 });

  const opening = ask("a");
  assert.equal(opening.type, "bid");
  assert.equal(opening.f, 2);
  assert.equal(liars.validate(state, "a", opening), null);

  // шесть шестёрок на шести костях при своих 4-5-6 — почти невозможно
  ({ state } = await liars.apply(state, "a", bid(6, 6), noCtx()));
  assert.deepEqual(ask("b"), { type: "challenge" });
  ({ state } = await liars.apply(state, "b", { type: "challenge" }, noCtx()));
  assert.deepEqual(ask(state.current), { type: "next" });
});

test("тайна: до вскрытия стаканчиков нет ни в общем виде, ни в событиях", async () => {
  for (let seed = 1; seed <= 150; seed++) {
    let lastShown = null;
    const { state: last } = await simulate(liars, bot, {
      seats: 2 + (seed % 5),
      seed,
      options: { dice: 3 + (seed % 4), onesWild: seed % 2 === 0, spotOn: seed % 3 !== 0 },
      onStep({ state, events }) {
        for (const event of events) {
          if (event.type === "revealed") lastShown = event.cups;
          else assert.equal(leaksCups(event), false, `событие ${event.type} раскрывает кости`);
        }
        const view = liars.publicView(state);
        assert.equal("cups" in view, false);
        assert.equal(view.totalDice, Object.values(state.counts).reduce((a, b) => a + b, 0));
        if (state.phase === "bidding") {
          // до первой ставки на столе лежит только уже открытое прошлого круга
          const { reveal, ...rest } = view;
          assert.equal(JSON.stringify(rest).includes("cup"), false);
          if (state.bid) assert.equal(reveal, null);
          if (reveal) assert.deepEqual(reveal.cups, lastShown);
          for (const id of state.order) {
            assert.equal(state.cups[id]?.length ?? 0, state.counts[id]);
          }
        }
        for (const id of state.order) {
          const mine = liars.privateView(state, id);
          if (state.counts[id] > 0) assert.deepEqual(mine, { cup: state.cups[id] });
          else assert.equal(mine, null);
        }
        const seat = liars.currentSeat(state);
        if (seat) {
          const legal = liars.legalActions(state, seat);
          assert.ok(legal.length > 0);
          for (const action of legal) assert.equal(liars.validate(state, seat, action), null);
        }
      },
    });
    assert.equal(last.finished, true);
  }
});

test("боты доигрывают 1600 партий без недопустимых ходов", async () => {
  for (let seed = 1; seed <= 1600; seed++) {
    const seats = 2 + (seed % 5);
    const options = { dice: 3 + (seed % 4), onesWild: Math.floor(seed / 20) % 2 === 0, spotOn: Math.floor(seed / 40) % 2 === 0 };
    const { state, result } = await simulate(liars, bot, { seats, seed, options });
    assert.equal(result.winners.length, 1);
    assert.equal(state.winner, result.winners[0]);
    const alive = state.order.filter((id) => state.counts[id] > 0);
    assert.deepEqual(alive, result.winners);
    assert.deepEqual(result.scores, state.counts);
    assert.equal(liars.currentSeat(state), null);
  }
});
