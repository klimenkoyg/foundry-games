/* Окно стола — общее для всех игр. Части: шапка, места, итог, поле игры, журнал, полоса ведущего.
   Поле и панель действий рисует адаптер игры (scripts/foundry/games/<id>.mjs). */

import { TEMPERAMENTS } from "../../core/temperaments.mjs";
import { MODULE_ID, SETTINGS, tpl } from "../constants.mjs";
import { Host } from "../host.mjs";
import { esc, has, money, plural, t } from "../i18n.mjs";
import { getGame } from "../registry.mjs";
import { canUserAct, seatActor, seatOfUser } from "../seating.mjs";
import { setting } from "../settings.mjs";
import { Privates, Store } from "../store.mjs";
import { report, sendAction } from "../transport.mjs";
import { coinsOf, isDnd5e } from "../wallet.mjs";
import { openRules } from "./rules-app.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const LOG_LINES = 40;

export function resolveTheme(table) {
  const override = setting(SETTINGS.themeOverride);
  return override && override !== "table" ? override : (table?.theme ?? setting(SETTINGS.defaultTheme));
}

export const motionOn = () =>
  setting(SETTINGS.animations) && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** «Перелистывание» граней, пока кость катится. */
function flicker(el) {
  const sides = Number(el.dataset.sides) || 6;
  const num = el.querySelector(".tg-poly__num");
  const final = num ? num.textContent : el.dataset.face;
  let n = 0;
  const timer = setInterval(() => {
    const v = n >= 7 ? final : 1 + Math.floor(Math.random() * sides);
    if (num) num.textContent = v;
    else el.dataset.face = v;
    if (n++ >= 7) clearInterval(timer);
  }, 78);
}

export class TableApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    const entry = getGame(Store.get(options.tableId)?.gameId);
    super({
      id: `tavern-table-${options.tableId}`,
      ...options,
      window: { icon: entry?.ui.icon ?? "fa-solid fa-dice", ...(options.window ?? {}) },
    });
    this.tableId = options.tableId;
    this.ui = {};          // местное состояние интерфейса игры (выбор костей и т. п.)
    this.seenSeq = null;   // до какого события этот клиент уже всё видел
    this.ctx = null;
    this.silentClose = false;
  }

  static DEFAULT_OPTIONS = {
    classes: ["tavern-games", "tg-table-app"],
    window: { resizable: true },
    position: { width: 640, height: "auto" },
    actions: {
      game: TableApp.#onGame,
      rules: TableApp.#onRules,
      leave: TableApp.#onLeave,
      gmAuto: TableApp.#onGmAuto,
      gmKick: TableApp.#onGmKick,
      gmHide: TableApp.#onGmHide,
      gmRemove: TableApp.#onGmRemove,
      gmRematch: TableApp.#onGmRematch,
    },
  };

  static PARTS = {
    head: { template: tpl("table/head.hbs") },
    seats: { template: tpl("table/seats.hbs") },
    banner: { template: tpl("table/banner.hbs") },
    board: { template: tpl("table/board.hbs") },
    log: { template: tpl("table/log.hbs"), scrollable: ["ol"] },
    gm: { template: tpl("table/gm.hbs") },
  };

  get table() {
    return Store.get(this.tableId);
  }

  get entry() {
    return getGame(this.table?.gameId);
  }

  get title() {
    const table = this.table;
    if (!table) return t("Title");
    const name = t(`Game.${table.gameId}.name`);
    return table.title && table.title !== name ? `${name} · ${table.title}` : name;
  }

  /* ---------------- отрисовка ---------------- */

  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    const template = this.entry?.ui.template;
    if (template) parts.board.template = template;
    return parts;
  }

  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    frame.dataset.tgTheme = resolveTheme(this.table);
    return frame;
  }

  /** Перерисовать после изменения стола. */
  refresh() {
    if (!this.table) return;
    this.render();
  }

  /** Перерисовать только поле — после местного действия (выбор кости). */
  rerenderBoard() {
    this.render({ parts: ["board"] });
  }

  buildContext() {
    const table = this.table;
    const entry = this.entry;
    const user = game.user;
    const view = table.view ?? {};
    const playing = table.status === "playing";
    const currentId = playing ? entry.rules.currentSeat(view) : null;
    const seatById = (id) => table.seats.find((s) => s.id === id) ?? null;
    const mySeat = seatOfUser(table, user);
    const current = seatById(currentId);
    const acting = current && canUserAct(user, current) ? current : null;
    // Чьё место внизу: своё; у ведущего без места — то, за которое он сейчас ходит.
    const me = mySeat ?? acting ?? null;
    const hostMine = (seatId) => (user.isGM ? Host.privateFor(table.id, seatId) : null);
    const mine = me ? (hostMine(me.id) ?? Privates.get(table.id, me.id)) : null;
    if (this.seenSeq === null) this.seenSeq = table.seq;

    const ctx = {
      app: this,
      table,
      entry,
      view,
      options: table.options,
      playing,
      finished: !playing,
      currentId,
      current,
      mySeat,
      me,
      acting,
      canAct: Boolean(acting),
      mine,
      isGM: user.isGM,
      ui: this.ui,
      fresh: table.events.filter((e) => e.seq > this.seenSeq),
      animate: motionOn(),
      seat: seatById,
      name: (id) => seatById(id)?.name ?? "?",
      privateOf: hostMine,
      send: (action) => this.send(action, acting?.id),
      rerender: () => this.rerenderBoard(),
      money: (amount) => money(amount, table.stake.coin),
    };
    this.ctx = ctx;
    return ctx;
  }

  seatVm(ctx, seat, { large = false } = {}) {
    const { table, entry } = ctx;
    const info = entry.ui.seatInfo?.(ctx, seat) ?? {};
    const isMe = seat.id === ctx.mySeat?.id;
    const isTurn = seat.id === ctx.currentId;
    const chips = [];
    if (seat.left) chips.push({ icon: "fa-person-walking-arrow-right", text: t("Seat.left"), cls: "tg-chip--danger" });
    else if (isMe) chips.push({ text: t("Seat.you"), cls: "tg-chip--accent" });
    else if (seat.control === "bot") chips.push({ icon: TEMPERAMENTS[seat.temperament]?.icon ?? "fa-robot", text: t(`Temper.${seat.temperament}`) });
    else if (seat.control === "gm") chips.push({ icon: "fa-crown", text: t("Seat.gm") });
    else if (seat.userId) chips.push({ icon: "fa-user", text: game.users.get(seat.userId)?.name ?? "" });
    chips.push(...(info.chips ?? []));

    let wallet = null;
    if (isMe && table.stake.amount && isDnd5e()) {
      const coins = coinsOf(seatActor(seat), table.stake.coin);
      if (coins !== null) wallet = money(coins, table.stake.coin);
    }
    return {
      id: seat.id,
      name: seat.name,
      img: seat.img,
      large,
      isTurn,
      isMe,
      isOut: seat.left || Boolean(info.out),
      isWinner: (table.result?.winners ?? []).includes(seat.id),
      thinking: isTurn && seat.control === "bot",
      chips,
      wallet,
      hasScore: info.score !== undefined && info.score !== null,
      score: info.score ?? null,
      scoreSub: info.scoreSub ?? null,
      scoreStruck: Boolean(info.scoreStruck),
      hasProgress: typeof info.progress === "number",
      progress: info.progress ?? null,
      pips: info.pips ?? null,
      extra: info.extra ?? null,
    };
  }

  async _prepareContext() {
    const table = this.table;
    if (!table || !this.entry) {
      this.ctx = null;
      return { missing: true };
    }
    const ctx = this.buildContext();
    const { entry } = ctx;
    const theme = resolveTheme(table);
    const stake = table.stake;

    const result = table.result;
    let banner = null;
    if (ctx.finished) {
      const names = (result?.winners ?? []).map(ctx.name);
      banner = {
        text: result?.aborted ? t("Banner.aborted") : names.length ? t("Banner.wins", { names: names.join(", ") }) : t("Banner.draw"),
        sub: stake.amount && table.payout
          ? table.payout.draw
            ? t("Banner.potReturned")
            : t("Banner.pot", { pot: money(table.payout.pot, stake.coin) })
          : null,
        // «Сыграть ещё» — только если за столом осталось достаточно мест.
        canRematch: ctx.isGM && table.seats.filter((s) => !s.left).length >= entry.rules.seats.min,
      };
    }

    const lines = [...table.events].reverse().slice(0, LOG_LINES).map((ev) => this.logLine(ctx, ev)).filter(Boolean);

    return {
      theme,
      isGM: ctx.isGM,
      playing: ctx.playing,
      gameName: t(`Game.${entry.id}.name`),
      subtitle: entry.ui.subtitle?.(ctx) ?? "",
      pot: stake.amount
        ? { sum: money(stake.pot, stake.coin), cap: t("Head.potCap", { stake: money(stake.amount, stake.coin) }), coins: [1, 2, 3, 4].slice(0, Math.min(4, Math.max(2, table.seats.length))) }
        : null,
      canLeave: Boolean(ctx.mySeat) && ctx.playing,
      hidden: table.hidden,
      rail: entry.ui.noRail ? [] : table.seats.filter((s) => s.id !== ctx.me?.id).map((s) => this.seatVm(ctx, s)),
      banner,
      log: { last: lines[0] ?? "", lines, count: table.seq },
      gmButtons: ctx.isGM ? (entry.ui.gmButtons?.(ctx) ?? []) : [],
    };
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    // Стол могли убрать, пока шла отрисовка, — тогда рисовать уже нечего.
    const ctx = this.ctx;
    if (partId !== "board" || context.missing || !ctx) return context;
    const board = ctx.entry.ui.board(ctx) ?? {};
    return {
      ...context,
      me: ctx.me ? this.seatVm(ctx, ctx.me, { large: true }) : null,
      status: !ctx.canAct && ctx.current ? t("Status.turnOf", { name: esc(ctx.current.name) }) : null,
      ...board,
    };
  }

  logLine(ctx, ev) {
    const name = `<b>${esc(ctx.name(ev.seat))}</b>`;
    const own = ctx.entry.ui.logLine?.(ctx, ev, name);
    if (own) return own;
    if (own === false) return null;
    if (has(`Log.${ev.type}`)) return t(`Log.${ev.type}`, { name });
    return null;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const table = this.table;
    if (!table) return;
    const el = this.element;
    el.dataset.tgTheme = resolveTheme(table);
    const animate = motionOn();
    el.classList.toggle("tg-no-motion", !animate);

    const ctx = this.ctx;
    if (ctx) {
      if (animate) for (const die of el.querySelectorAll(".tg-die.is-rolling, .tg-poly.is-rolling")) flicker(die);
      const rollEvents = ctx.entry.ui.rollEvents ?? [];
      if (ctx.fresh.some((e) => rollEvents.includes(e.type)) && setting(SETTINGS.sounds) && !game.dice3d) {
        foundry.audio.AudioHelper.play({ src: CONFIG.sounds.dice, volume: 0.6 }, false);
      }
      ctx.entry.ui.afterRender?.(ctx, el);
    }
    // Журнал помнит, развёрнут ли он, между перерисовками.
    const log = el.querySelector(".tg-log");
    if (log) {
      log.open = Boolean(this.logOpen);
      log.addEventListener("toggle", () => (this.logOpen = log.open));
    }
    this.seenSeq = table.seq;
  }

  /* ---------------- действия ---------------- */

  /** Отправить ход ведущему от имени места, за которое сейчас ходит этот пользователь. */
  async send(action, seatId = this.ctx?.acting?.id) {
    if (!seatId) return { ok: false, error: "notYourTurn" };
    return sendAction(this.tableId, seatId, action);
  }

  static #onGame(event, target) {
    if (!this.ctx) return;
    this.ctx.entry.ui.onAction?.(this.ctx, target.dataset.op, target.dataset.arg, target, event);
  }

  static #onRules() {
    openRules(this.table.gameId, this.table);
  }

  static async #onLeave() {
    const seat = this.ctx?.mySeat;
    if (!seat) return;
    const stake = this.table.stake;
    const ok = await DialogV2.confirm({
      window: { title: t("Leave.title") },
      content: `<p>${t(stake.amount ? "Leave.textStake" : "Leave.text")}</p>`,
    });
    if (ok) sendAction(this.tableId, seat.id, { type: "leave" });
  }

  static async #onGmAuto() {
    report(await Host.autoMove(this.tableId));
  }

  static async #onGmKick() {
    const table = this.table;
    const seats = table.seats.filter((s) => !s.left);
    const options = seats.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
    const refund = table.stake.amount
      ? `<label class="checkbox"><input type="checkbox" name="refund"> ${t("Kick.refund")}</label>`
      : "";
    const data = await DialogV2.wait({
      window: { title: t("Kick.title") },
      content: `<div class="form-group"><label>${t("Kick.who")}</label><select name="seat">${options}</select></div>${refund}`,
      buttons: [
        {
          action: "ok",
          label: t("Kick.confirm"),
          default: true,
          callback: (ev, button) => ({
            seatId: button.form.elements.seat.value,
            refund: Boolean(button.form.elements.refund?.checked),
          }),
        },
        { action: "cancel", label: t("Common.cancel") },
      ],
      rejectClose: false,
    });
    if (data && data !== "cancel") report(await Host.kick(this.tableId, data.seatId, { refund: data.refund }));
  }

  static async #onGmHide() {
    report(await Host.setHidden(this.tableId, !this.table.hidden));
  }

  static async #onGmRemove() {
    const refund = await confirmRemove(this.table);
    if (refund === null) return;
    report(await Host.removeTable(this.tableId, { refund }));
  }

  static async #onGmRematch() {
    report(await Host.rematch(this.tableId));
  }

  _onClose(options) {
    super._onClose(options);
    Hooks.callAll(`${MODULE_ID}.tableClosed`, this.tableId, Boolean(this.silentClose));
  }
}

/** Спросить ведущего про снятие стола. Возвращает: true — вернуть ставки, false — не возвращать, null — отмена. */
export async function confirmRemove(table) {
  const withStake = table.status === "playing" && table.stake.amount > 0;
  if (!withStake) {
    const ok = await DialogV2.confirm({
      window: { title: t("Remove.title") },
      content: `<p>${t("Remove.text", { title: esc(table.title) })}</p>`,
    });
    return ok ? false : null;
  }
  const choice = await DialogV2.wait({
    window: { title: t("Remove.title") },
    content: `<p>${t("Remove.textStake", { title: esc(table.title), n: plural(table.seats.length, "Seats") })}</p>`,
    buttons: [
      { action: "refund", label: t("Remove.refund"), default: true },
      { action: "keep", label: t("Remove.keep") },
      { action: "cancel", label: t("Common.cancel") },
    ],
    rejectClose: false,
  });
  if (choice === "refund") return true;
  if (choice === "keep") return false;
  return null;
}
