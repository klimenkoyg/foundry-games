/* Чтение столов на любом клиенте и личные (скрытые) виды, которые ведущий
   присылает владельцу места. Пишет столы только хост ведущего (host.mjs). */

import { MODULE_ID, SETTINGS } from "./constants.mjs";

export const Store = {
  all() {
    return game.settings.get(MODULE_ID, SETTINGS.tables) ?? {};
  },

  get(id) {
    return this.all()[id] ?? null;
  },

  list() {
    return Object.values(this.all()).sort((a, b) => a.createdAt - b.createdAt);
  },
};

/** Скрытые виды мест этого клиента: tableId → { seatId → { rev, view } }. */
export const Privates = {
  map: new Map(),

  receive({ tableId, seatId, rev, view }) {
    if (!this.map.has(tableId)) this.map.set(tableId, {});
    this.map.get(tableId)[seatId] = { rev, view };
    Hooks.callAll(`${MODULE_ID}.private`, tableId);
  },

  get(tableId, seatId) {
    return this.map.get(tableId)?.[seatId]?.view ?? null;
  },

  drop(tableId) {
    this.map.delete(tableId);
  },
};
