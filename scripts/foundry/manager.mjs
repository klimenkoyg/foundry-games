/* Окна столов на этом клиенте: открыть для новых столов, обновить при изменениях,
   закрыть для убранных. Закрытое крестиком окно само не возвращается — пока ведущий
   не нажмёт «Вернуть окно». */

import { MODULE_ID } from "./constants.mjs";
import { TableApp } from "./apps/table-app.mjs";
import { getGame } from "./registry.mjs";
import { seatOfUser } from "./seating.mjs";
import { Privates, Store } from "./store.mjs";
import { requestSync } from "./transport.mjs";

export const Manager = {
  apps: new Map(),
  dismissed: new Set(),
  summons: new Map(),
  ready: false,

  init() {
    Hooks.on(`${MODULE_ID}.tableClosed`, (tableId, silent) => {
      this.apps.delete(tableId);
      if (!silent) this.dismissed.add(tableId);
    });
    Hooks.on(`${MODULE_ID}.private`, (tableId) => this.apps.get(tableId)?.refresh());
    this.ready = true;
    this.refresh();
  },

  refresh() {
    if (!this.ready) return;
    const tables = Store.all();

    for (const [id, app] of this.apps) {
      if (tables[id]) continue;
      this.closeSilently(app);
      this.dismissed.delete(id);
      this.summons.delete(id);
      Privates.drop(id);
    }

    let offset = this.apps.size;
    for (const table of Object.values(tables)) {
      if (!getGame(table.gameId)) continue;
      if (this.summons.has(table.id) && this.summons.get(table.id) !== table.summon) this.dismissed.delete(table.id);
      this.summons.set(table.id, table.summon);

      const visible = !table.hidden || game.user.isGM;
      const app = this.apps.get(table.id);
      if (!visible) {
        if (app) this.closeSilently(app);
        continue;
      }
      if (app) {
        app.refresh();
        continue;
      }
      if (!this.dismissed.has(table.id)) this.open(table, offset++);
    }
    Hooks.callAll(`${MODULE_ID}.tables`);
  },

  open(table, offset = 0) {
    const app = new TableApp({ tableId: table.id, position: { left: 120 + offset * 36, top: 70 + offset * 36 } });
    this.apps.set(table.id, app);
    app.render({ force: true });
    // Скрытое этого игрока (стаканчик) могло прийти раньше, чем он вошёл в мир.
    if (getGame(table.gameId).rules.hasSecrets && seatOfUser(table, game.user)) requestSync();
  },

  closeSilently(app) {
    app.silentClose = true;
    this.apps.delete(app.tableId);
    app.close();
  },

  /** Показать окно стола снова (ведущий из лобби, игрок кнопкой на панели). */
  reopen(tableId) {
    this.dismissed.delete(tableId);
    const app = this.apps.get(tableId);
    if (app) app.bringToFront();
    else this.refresh();
  },

  reopenAll() {
    this.dismissed.clear();
    this.refresh();
    for (const app of this.apps.values()) app.bringToFront();
    return this.apps.size;
  },
};
