/* Прогон партии ботами: проверяет, что боты не делают недопустимых ходов,
   что apply не меняет входное состояние и что партия заканчивается. */

import { makeLocalCtx } from "../../scripts/core/engine.mjs";
import { TEMPERAMENT_IDS, temperament } from "../../scripts/core/temperaments.mjs";
import { mulberry32 } from "../../scripts/core/util.mjs";

export async function simulate(def, bot, { seats = 3, options = {}, seed = 1, maxSteps = 20000, onStep } = {}) {
  const rng = mulberry32(seed);
  const ctx = makeLocalCtx(rng);
  const seatIds = Array.from({ length: seats }, (_, i) => `s${i + 1}`);
  const temps = Object.fromEntries(seatIds.map((id, i) => [id, TEMPERAMENT_IDS[(seed + i) % TEMPERAMENT_IDS.length]]));
  const opts = def.normalizeOptions(options);
  let state = await def.setup({ seatIds, options: opts, ctx });
  const events = [];
  let steps = 0;

  while (!def.result(state)) {
    if (++steps > maxSteps) throw new Error(`партия не закончилась за ${maxSteps} ходов`);
    const seatId = def.currentSeat(state);
    if (!seatId) throw new Error("нет текущего места, а партия не окончена");

    const view = structuredClone(def.publicView(state));
    const mine = structuredClone(def.privateView(state, seatId));
    const action = bot({ view, mine, seatId, options: opts, temperament: temperament(temps[seatId]), rng });
    const err = def.validate(state, seatId, action);
    if (err) throw new Error(`бот (${temps[seatId]}) сделал недопустимый ход ${JSON.stringify(action)}: ${err}`);

    const before = JSON.stringify(state);
    const res = await def.apply(state, seatId, action, ctx);
    if (JSON.stringify(state) !== before) throw new Error("apply изменил входное состояние");
    state = res.state;
    events.push(...res.events);
    JSON.parse(JSON.stringify(state));
    onStep?.({ state, seatId, action, events: res.events });
  }
  return { state, result: def.result(state), steps, events, seatIds };
}
