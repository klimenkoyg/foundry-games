/* Панель ведущего: список игр с описанием и идущие столы. */

import { IDEAS_URL, MODULE_ID, SETTINGS, tpl } from "../constants.mjs";
import { diceHtml, polyHtml } from "../handlebars.mjs";
import { Host } from "../host.mjs";
import { money, plural, t } from "../i18n.mjs";
import { Manager } from "../manager.mjs";
import { getGame, listGames } from "../registry.mjs";
import { setSetting, setting } from "../settings.mjs";
import { Store } from "../store.mjs";
import { report } from "../transport.mjs";
import { openRules } from "./rules-app.mjs";
import { SeatingApp } from "./seating-app.mjs";
import { confirmRemove } from "./table-app.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Кости на сукне в описании игры. */
const PREVIEW = {
  farkle: () => diceHtml([1, 5, 5, 2, 6, 3]),
  liars: () => diceHtml([5, 5, 1, 3]),
  poker: () => diceHtml([4, 4, 4, 6, 6]),
  kb: () => diceHtml([3, 3, 5]),
  tw: () => [[4, 3], [8, 6], [12, 9], [20, 14]].map(([s, v]) => polyHtml(s, { value: v })).join(""),
  scc: () => diceHtml([6, 5, 4, 3, 6]),
};

export class LobbyApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tavern-lobby",
    classes: ["tavern-games", "tg-lobby-app"],
    window: { icon: "fa-solid fa-beer-mug-empty", resizable: true },
    position: { width: 760, height: "auto" },
    actions: {
      pick: LobbyApp.#onPick,
      seat: LobbyApp.#onSeat,
      rules: LobbyApp.#onRules,
      tableOpen: LobbyApp.#onTableOpen,
      tableHide: LobbyApp.#onTableHide,
      tableSummon: LobbyApp.#onTableSummon,
      tableRemove: LobbyApp.#onTableRemove,
    },
  };

  static PARTS = { body: { template: tpl("lobby.hbs") } };

  static open() {
    const open = foundry.applications.instances.get("tavern-lobby");
    if (open) {
      open.bringToFront();
      return open;
    }
    const app = new LobbyApp();
    app.render({ force: true });
    return app;
  }

  get title() {
    return t("Title");
  }

  get selected() {
    const id = this._selected ?? setting(SETTINGS.lastGame);
    return getGame(id) ? id : listGames()[0].id;
  }

  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    frame.dataset.tgTheme = setting(SETTINGS.defaultTheme);
    return frame;
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this._hook = Hooks.on(`${MODULE_ID}.tables`, () => this.render());
  }

  _onClose(options) {
    super._onClose(options);
    Hooks.off(`${MODULE_ID}.tables`, this._hook);
  }

  async _prepareContext() {
    const selected = this.selected;
    const entry = getGame(selected);
    const { min, max } = entry.rules.seats;

    const facts = [{ icon: "fa-users", text: min === max ? plural(min, "Lobby.seatsExact") : t("Lobby.seatsRange", { min, max }) }];
    facts.push({ icon: "fa-robot", text: t("Lobby.bots") });
    facts.push({ icon: "fa-coins", text: t("Lobby.stakes") });
    if (entry.rules.hasSecrets) facts.push({ icon: "fa-eye-slash", text: t("Lobby.secrets") });

    const tables = Store.list().map((table) => {
      const tEntry = getGame(table.gameId);
      const seat = (id) => table.seats.find((s) => s.id === id);
      let status;
      if (table.status === "playing") {
        const current = seat(tEntry?.rules.currentSeat(table.view ?? {}));
        const bits = [];
        if (current) bits.push(t("Status.turnOf", { name: current.name }));
        if (table.stake.amount) bits.push(t("Lobby.pot", { pot: money(table.stake.pot, table.stake.coin) }));
        status = bits.join(" · ");
      } else {
        const names = (table.result?.winners ?? []).map((id) => seat(id)?.name).filter(Boolean);
        status = names.length ? t("Lobby.wonBy", { names: names.join(", ") }) : t("Lobby.over");
      }
      return {
        id: table.id,
        title: `${t(`Game.${table.gameId}.name`)} · ${table.title}`,
        faces: table.seats.slice(0, 5).map((s) => s.img),
        status,
        hidden: table.hidden,
      };
    });

    return {
      isGM: game.user.isGM,
      ideasUrl: game.user.isGM ? IDEAS_URL : "",
      games: listGames().map((g) => ({
        id: g.id,
        name: t(`Game.${g.id}.name`),
        meta: t(`Game.${g.id}.meta`),
        icon: g.ui.icon,
        selected: g.id === selected,
      })),
      detail: {
        id: selected,
        name: t(`Game.${selected}.name`),
        text: t(`Game.${selected}.text`),
        preview: PREVIEW[selected]?.() ?? "",
        facts,
      },
      tables,
    };
  }

  static #onPick(event, target) {
    this._selected = target.dataset.game;
    setSetting(SETTINGS.lastGame, this._selected);
    this.render();
  }

  static #onSeat() {
    SeatingApp.open(this.selected);
  }

  static #onRules() {
    openRules(this.selected);
  }

  static #onTableOpen(event, target) {
    Manager.reopen(target.closest("[data-table]").dataset.table);
  }

  static async #onTableHide(event, target) {
    const id = target.closest("[data-table]").dataset.table;
    report(await Host.setHidden(id, !Store.get(id)?.hidden));
  }

  static async #onTableSummon(event, target) {
    report(await Host.summon(target.closest("[data-table]").dataset.table));
  }

  static async #onTableRemove(event, target) {
    const id = target.closest("[data-table]").dataset.table;
    const table = Store.get(id);
    if (!table) return;
    const refund = await confirmRemove(table);
    if (refund === null) return;
    report(await Host.removeTable(id, { refund }));
  }
}
