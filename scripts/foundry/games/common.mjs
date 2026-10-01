/* Общее для адаптеров игр. */

import { diceHtml } from "../handlebars.mjs";

/** Мелкие кости в строке журнала. */
export const inlineDice = (values) => diceHtml(values ?? []);

/** Последнее событие стола одного из типов. */
export function lastEvent(table, types) {
  for (let i = table.events.length - 1; i >= 0; i--) {
    if (types.includes(table.events[i].type)) return table.events[i];
  }
  return null;
}

/** Было ли среди новых событий такое (для запуска анимации ровно один раз). */
export const isFresh = (ctx, type, test = () => true) => ctx.animate && ctx.fresh.some((e) => e.type === type && test(e));

export const cls = (...list) => list.flat().filter(Boolean).join(" ");
