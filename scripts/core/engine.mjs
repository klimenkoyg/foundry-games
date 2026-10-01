/* Контракт игры и общий порядок применения хода.

   Игра — объект по умолчанию из scripts/core/games/<id>.mjs:

   {
     id: string,
     seats: { min, max },
     hasSecrets: boolean,            // есть ли скрытое (стаканчики «Костей лжеца»)
     options: OptionSchema[],        // настройки при посадке
     normalizeOptions(raw) → options
     async setup({ seatIds, options, ctx }) → state     // seatIds — порядок ходов
     currentSeat(state) → seatId | null                  // чей ход; null — партия окончена
     legalActions(state, seatId) → Action[]              // перечислимые ходы (для ботов и проверок)
     validate(state, seatId, action) → null | errorCode  // errorCode — ключ TAVERN.Error.<code>
     async apply(state, seatId, action, ctx) → { state, events }   // вход НЕ меняется
     async removeSeat(state, seatId, ctx) → { state, events }      // место ушло из-за стола
     publicView(state) → object       // то, что видят все; без секретов
     privateView(state, seatId) → object | null   // секреты одного места
     result(state) → null | { winners: seatId[], draw?: boolean, scores?: {seatId: number},
                              extra?: {seatId: number} }   // extra — ставки сверх входной (покер)
   }

   OptionSchema = { key, type: "number" | "bool" | "select", default, min?, max?, step?, choices? }

   ctx = {
     rng(): number                    // [0, 1) — для решений, не для костей
     async roll(dice, opts?) → number[][]
        dice: [{ sides, count }]      // один бросок может состоять из разных костей
        opts: { seat?, secret?, reason? }   // secret — не показывать бросок всем
   }

   Event = { type: string, seat?: seatId, ...данные }  — уходит в журнал и анимации.
   Тексты журнала собирает клиент из событий на своём языке.

   Бот — функция по умолчанию из scripts/core/bots/<id>.mjs:
     decide({ view, mine, seatId, options, temperament, rng }) → Action
   view = publicView(state), mine = privateView(state, seatId). Бот видит только это.
*/

import { rollDie } from "./util.mjs";

export class GameError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** Проверяет и применяет ход. Бросает GameError с кодом причины. */
export async function runAction(def, state, seatId, action, ctx) {
  const err = def.validate(state, seatId, action);
  if (err) throw new GameError(err);
  return def.apply(state, seatId, action, ctx);
}

/** ctx на основе генератора чисел: для тестов и для броска без Foundry. */
export function makeLocalCtx(rng) {
  return {
    rng,
    async roll(dice) {
      return dice.map(({ sides, count }) => Array.from({ length: count }, () => rollDie(rng, sides)));
    },
  };
}

/** ctx с заранее заданными бросками: makeScriptedCtx([[6, 5, 4, 3, 3], [2]]). */
export function makeScriptedCtx(queue, rng = Math.random) {
  const rest = [...queue];
  return {
    rng,
    async roll(dice) {
      return dice.map(({ sides, count }) => {
        const next = rest.shift();
        if (!next) throw new Error("scripted ctx: бросков больше не задано");
        if (next.length !== count) throw new Error(`scripted ctx: ждали ${count} костей, задано ${next.length}`);
        if (next.some((v) => v < 1 || v > sides)) throw new Error(`scripted ctx: значение вне к${sides}`);
        return [...next];
      });
    },
    remaining: () => rest.length,
  };
}
