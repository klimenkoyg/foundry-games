/* Окно посадки: кто садится за стол. Игроки в сети, токены сцены («Взять выделенные»,
   поиск), перетаскивание актёра из сайдбара, кнопка «За стол» в меню токена.
   У NPC — переключатель «Бот / Ведущий» и нрав. Ниже — настройки игры, ставка, оформление. */

import { TEMPERAMENT_IDS } from "../../core/temperaments.mjs";
import { SETTINGS, THEMES, tpl } from "../constants.mjs";
import { Host } from "../host.mjs";
import { money, plural, t } from "../i18n.mjs";
import { getGame, listGames } from "../registry.mjs";
import { seatFromActor, seatFromToken, seatFromUser, tokenImage, uniqueName } from "../seating.mjs";
import { setSetting, setting } from "../settings.mjs";
import { report } from "../transport.mjs";
import { coinChoices, defaultCoin, isDnd5e } from "../wallet.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const APP_ID = "tavern-seating";
const norm = (s) => String(s ?? "").toLowerCase().replaceAll("ё", "е");

export class SeatingApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.seats = [];
    this.search = "";
    this.title_ = "";
    this.theme = setting(SETTINGS.defaultTheme);
    this.stake = { amount: 0, coin: defaultCoin(), fromSheets: true, npcPays: "house" };
    this.setGame(options.gameId ?? setting(SETTINGS.lastGame));
  }

  static DEFAULT_OPTIONS = {
    id: APP_ID,
    classes: ["tavern-games", "tg-seating-app"],
    window: { icon: "fa-solid fa-chair", resizable: true },
    position: { width: 820, height: "auto" },
    actions: {
      addUser: SeatingApp.#onAddUser,
      addToken: SeatingApp.#onAddToken,
      takeSelected: SeatingApp.#onTakeSelected,
      removeSeat: SeatingApp.#onRemoveSeat,
      setControl: SeatingApp.#onSetControl,
      setTheme: SeatingApp.#onSetTheme,
      setNpcPays: SeatingApp.#onSetNpcPays,
      start: SeatingApp.#onStart,
      cancel: SeatingApp.#onCancel,
    },
  };

  static PARTS = { body: { template: tpl("seating.hbs") } };

  static get instance() {
    return foundry.applications.instances.get(APP_ID) ?? null;
  }

  /** Открыть окно (или поднять уже открытое) для игры. */
  static open(gameId) {
    let app = this.instance;
    if (app) {
      if (gameId && gameId !== app.gameId) app.setGame(gameId);
      app.render();
      app.bringToFront();
      return app;
    }
    app = new SeatingApp({ gameId });
    app.render({ force: true });
    return app;
  }

  /** «За стол» из меню токена. */
  static addToken(tokenDoc) {
    const app = this.open();
    app.addSeat(seatFromToken(tokenDoc));
    return app;
  }

  get title() {
    return t("Seating.title", { game: t(`Game.${this.gameId}.name`) });
  }

  get entry() {
    return getGame(this.gameId);
  }

  setGame(gameId) {
    this.gameId = getGame(gameId) ? gameId : listGames()[0].id;
    this.options_ = this.entry.rules.normalizeOptions({});
  }

  /* ---------------- места ---------------- */

  addSeat(seat) {
    const { max } = this.entry.rules.seats;
    if (this.seats.length >= max) {
      ui.notifications.warn(t("Seating.full", { max }));
      return false;
    }
    if (seat.tokenUuid && this.seats.some((s) => s.tokenUuid === seat.tokenUuid)) return false;
    // Один игрок — одно место: его второй токен садится как NPC под рукой ведущего.
    if (seat.userId && this.seats.some((s) => s.userId === seat.userId)) {
      if (!seat.tokenUuid && !seat.actorUuid) return false;
      seat = { ...seat, userId: null, kind: "npc", control: "gm" };
    }
    seat.name = uniqueName(seat.name, this.seats.map((s) => s.name));
    this.seats.push(seat);
    this.render();
    return true;
  }

  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    frame.dataset.tgTheme = this.theme;
    return frame;
  }

  async _prepareContext() {
    const entry = this.entry;
    const { min, max } = entry.rules.seats;
    const dnd5e = isDnd5e();
    const seatedTokens = new Set(this.seats.map((s) => s.tokenUuid).filter(Boolean));
    const seatedUsers = new Set(this.seats.map((s) => s.userId).filter(Boolean));
    const controlled = new Set((canvas?.tokens?.controlled ?? []).map((tk) => tk.document.uuid));

    const users = game.users
      .filter((u) => !u.isGM)
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
      .map((u) => ({
        id: u.id,
        name: u.character?.name ?? u.name,
        sub: t(u.active ? "Seating.player" : "Seating.playerOffline", { name: u.name }),
        img: u.character?.img || u.avatar || "icons/svg/mystery-man.svg",
        seated: seatedUsers.has(u.id),
      }));

    const tokens = (canvas?.scene?.tokens?.contents ?? [])
      .map((td) => {
        const owner = td.actor ? game.users.find((u) => !u.isGM && td.actor.testUserPermission(u, "OWNER")) : null;
        const bits = [owner ? t("Seating.player", { name: owner.name }) : t("Seating.npc")];
        if (controlled.has(td.uuid)) bits.push(t("Seating.selected"));
        if (td.hidden) bits.push(t("Seating.hiddenToken"));
        return {
          uuid: td.uuid,
          name: td.name,
          key: norm(td.name),
          sub: bits.join(" · "),
          img: tokenImage(td),
          selected: controlled.has(td.uuid),
          seated: seatedTokens.has(td.uuid) || (owner && seatedUsers.has(owner.id) && this.seats.some((s) => s.userId === owner.id && s.tokenUuid === td.uuid)),
        };
      })
      .sort((a, b) => Number(b.selected) - Number(a.selected) || a.name.localeCompare(b.name));

    const selectedFree = tokens.filter((tk) => tk.selected && !tk.seated).length;

    const seats = this.seats.map((s) => ({
      ...s,
      isNpc: s.kind === "npc",
      isBot: s.control === "bot",
      owner: s.userId ? game.users.get(s.userId)?.name : null,
      tempers: TEMPERAMENT_IDS.map((id) => ({ id, label: t(`Temper.${id}`), selected: id === s.temperament })),
    }));

    const hidden = entry.ui.hiddenOptions ?? [];
    const options = entry.rules.options
      .filter((o) => !hidden.includes(o.key))
      .map((o) => ({
        ...o,
        label: t(`Game.${entry.id}.opt.${o.key}`),
        value: this.options_[o.key],
        isNumber: o.type === "number",
        isBool: o.type === "bool",
      }));

    const n = this.seats.length;
    const stake = this.stake;
    let problem = null;
    if (n < min) problem = min === max ? plural(min, "Seating.needExact") : t("Seating.needMin", { min });
    return {
      games: listGames().map((g) => ({ id: g.id, name: t(`Game.${g.id}.name`), selected: g.id === this.gameId })),
      tableTitle: this.title_,
      titlePlaceholder: canvas?.scene?.name ?? t(`Game.${this.gameId}.name`),
      sceneName: canvas?.scene?.name ?? "",
      users,
      tokens,
      search: this.search,
      selectedFree,
      seats,
      seatCount: plural(n, "Seats"),
      options,
      dnd5e,
      stake,
      coins: coinChoices().map((c) => ({ id: c, label: c === "chips" ? t("Coin.chipsShort") : t(`Coin.${c}`), selected: c === stake.coin })),
      npcSheet: stake.npcPays === "sheet",
      themes: THEMES.map((id) => ({ id, label: t(`Theme.${id}`), icon: id === "tavern" ? "fa-beer-mug-empty" : "fa-scroll", selected: id === this.theme })),
      summary: stake.amount > 0 ? t("Seating.summaryPot", { seats: plural(n, "Seats"), pot: money(stake.amount * n, stake.coin) }) : plural(n, "Seats"),
      problem,
      canStart: !problem && n <= max,
    };
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    const el = this.element;
    // Поля меняют состояние окна сразу, без перерисовки — фокус не теряется.
    el.addEventListener("change", (ev) => this.#onChange(ev));
    el.addEventListener("input", (ev) => {
      if (ev.target.name === "search") this.#filter(ev.target.value);
    });
    el.addEventListener("dragover", (ev) => ev.preventDefault());
    el.addEventListener("drop", (ev) => this.#onDrop(ev));
    this._controlHook = Hooks.on("controlToken", () => this.render());
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.dataset.tgTheme = this.theme;
    this.#filter(this.search);
    for (const row of this.element.querySelectorAll(".tg-seatrow")) {
      row.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/tavern-seat", row.dataset.seatId);
        ev.dataTransfer.effectAllowed = "move";
      });
    }
  }

  _onClose(options) {
    super._onClose(options);
    Hooks.off("controlToken", this._controlHook);
  }

  #filter(value) {
    this.search = value;
    const q = norm(value).trim();
    for (const li of this.element.querySelectorAll("[data-token-key]")) {
      li.hidden = Boolean(q) && !li.dataset.tokenKey.includes(q);
    }
  }

  #onChange(ev) {
    const target = ev.target;
    const name = target.name ?? "";
    if (name === "gameId") {
      this.setGame(target.value);
      setSetting(SETTINGS.lastGame, this.gameId);
      const { max } = this.entry.rules.seats;
      if (this.seats.length > max) this.seats.length = max;
      return this.render();
    }
    if (name === "title") this.title_ = target.value.trim();
    else if (name === "stake.amount") {
      this.stake.amount = Math.max(0, Math.floor(Number(target.value) || 0));
      return this.render();
    } else if (name === "stake.coin") {
      this.stake.coin = target.value;
      return this.render();
    } else if (name === "stake.fromSheets") {
      this.stake.fromSheets = target.checked;
      return this.render();
    } else if (name.startsWith("opt.")) {
      const key = name.slice(4);
      const raw = target.type === "checkbox" ? target.checked : target.value;
      this.options_ = this.entry.rules.normalizeOptions({ ...this.options_, [key]: raw });
      return this.render();
    } else if (target.dataset.seatName) {
      const seat = this.seats.find((s) => s.id === target.dataset.seatName);
      if (seat && target.value.trim()) seat.name = target.value.trim();
    } else if (target.dataset.seatTemper) {
      const seat = this.seats.find((s) => s.id === target.dataset.seatTemper);
      if (seat) seat.temperament = target.value;
    }
  }

  async #onDrop(ev) {
    // Перестановка мест — порядок ходов.
    const moved = ev.dataTransfer.getData("text/tavern-seat");
    if (moved) {
      ev.preventDefault();
      const over = ev.target.closest(".tg-seatrow")?.dataset.seatId;
      const from = this.seats.findIndex((s) => s.id === moved);
      if (from < 0) return;
      const [seat] = this.seats.splice(from, 1);
      const to = over ? this.seats.findIndex((s) => s.id === over) : this.seats.length;
      this.seats.splice(to < 0 ? this.seats.length : to, 0, seat);
      return this.render();
    }
    // Актёр или токен, перетащенный из сайдбара.
    let data;
    try {
      data = JSON.parse(ev.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    if (!data?.uuid || !["Actor", "Token"].includes(data.type)) return;
    ev.preventDefault();
    const doc = await fromUuid(data.uuid);
    if (!doc) return;
    this.addSeat(data.type === "Token" ? seatFromToken(doc) : seatFromActor(doc));
  }

  /* ---------------- действия ---------------- */

  static #onAddUser(event, target) {
    const user = game.users.get(target.closest("[data-user-id]").dataset.userId);
    if (user) this.addSeat(seatFromUser(user));
  }

  static async #onAddToken(event, target) {
    const doc = await fromUuid(target.closest("[data-token-uuid]").dataset.tokenUuid);
    if (doc) this.addSeat(seatFromToken(doc));
  }

  static #onTakeSelected() {
    const tokens = canvas?.tokens?.controlled ?? [];
    if (!tokens.length) return ui.notifications.info(t("Seating.nothingSelected"));
    for (const tk of tokens) this.addSeat(seatFromToken(tk.document));
  }

  static #onRemoveSeat(event, target) {
    const id = target.closest("[data-seat-id]").dataset.seatId;
    this.seats = this.seats.filter((s) => s.id !== id);
    this.render();
  }

  static #onSetControl(event, target) {
    const seat = this.seats.find((s) => s.id === target.closest("[data-seat-id]").dataset.seatId);
    if (!seat) return;
    seat.control = target.dataset.value;
    this.render();
  }

  static #onSetTheme(event, target) {
    this.theme = target.dataset.value;
    this.render();
  }

  static #onSetNpcPays(event, target) {
    this.stake.npcPays = target.dataset.value;
    this.render();
  }

  static async #onStart() {
    const entry = this.entry;
    const stake = { ...this.stake, fromSheets: this.stake.fromSheets && isDnd5e() };
    const options = entry.ui.prepareOptions?.(this.options_, stake) ?? this.options_;
    const res = report(
      await Host.createTable({
        gameId: this.gameId,
        title: this.title_ || canvas?.scene?.name || "",
        theme: this.theme,
        seats: this.seats.map((s) => ({ ...s })),
        options,
        stake,
      }),
    );
    if (res?.ok) {
      setSetting(SETTINGS.lastGame, this.gameId);
      this.close();
    }
  }

  static #onCancel() {
    this.close();
  }
}
