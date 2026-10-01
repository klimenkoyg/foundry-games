/* Хост стола — работает только у активного ведущего.
   Принимает ходы, проверяет их правилами, бросает кости, пишет публичное состояние
   в настройку мира, ведёт ботов, собирает и выдаёт ставки.

   Стол (то, что лежит в настройке мира и видно всем):
   {
     id, gameId, title, theme, status: "playing" | "finished", hidden, createdAt,
     seats: [{ id, name, img, kind, userId, actorUuid, tokenUuid, control, temperament, left }],
     options, stake: { amount, coin, fromSheets, npcPays, paid: {seatId: bool}, refunded: [seatId], pot },
     rev, seq, events: [{ seq, type, ... }], view, result, payout, summon
   }
   Полное состояние игры (с секретами) живёт в памяти хоста и в client-настройке ведущего. */

import { GameError, runAction } from "../core/engine.mjs";
import { temperament } from "../core/temperaments.mjs";
import { sum } from "../core/util.mjs";
import { EVENT_LIMIT, MODULE_ID, QUERY, SETTINGS } from "./constants.mjs";
import { rollDice } from "./dice.mjs";
import { esc, money, plural, t } from "./i18n.mjs";
import { getGame } from "./registry.mjs";
import { canUserAct, seatActor } from "./seating.mjs";
import { setSetting, setting } from "./settings.mjs";
import { charge, isDnd5e, pay } from "./wallet.mjs";

const clone = (v) => foundry.utils.deepClone(v);

/** Платит ли место с листа (иначе ставка «на ведущем»). */
function paysFromSheet(table, seat) {
  const s = table.stake;
  if (!s.amount || !s.fromSheets || !isDnd5e()) return false;
  return seat.kind === "player" || s.npcPays === "sheet";
}

function potOf(table) {
  const s = table.stake;
  const antes = s.amount * (table.seats.length - s.refunded.length);
  const bets = sum(Object.values(table.view?.bets ?? {})) + sum(Object.values(table.view?.leftBets ?? {}));
  return antes + bets;
}

export const Host = {
  active: false,
  tables: new Map(),
  states: new Map(),
  queues: new Map(),
  timers: new Map(),
  _write: Promise.resolve(),

  /** Этот клиент — активный ведущий? */
  isMine() {
    return game.user.isGM && game.users.activeGM?.id === game.user.id;
  },

  /** Вызывается при входе в мир и при смене состава ведущих. */
  ensure() {
    if (!this.isMine()) {
      if (this.active) this.clearTimers();
      this.active = false;
      return;
    }
    if (this.active) return;
    this.active = true;
    this.load();
  },

  load() {
    this.tables = new Map(Object.entries(clone(setting(SETTINGS.tables) ?? {})));
    this.states = new Map();
    const secrets = setting(SETTINGS.secrets) ?? {};
    let dirty = false;
    for (const table of this.tables.values()) {
      if (table.status !== "playing") continue;
      const entry = getGame(table.gameId);
      const state = entry?.rules.hasSecrets ? secrets[table.id] : table.view;
      if (!entry || !state) {
        // Скрытое состояние осталось в другом браузере — доиграть нельзя.
        this.abort(table);
        dirty = true;
        continue;
      }
      this.states.set(table.id, clone(state));
    }
    if (dirty) this.persist();
    for (const id of this.states.keys()) this.scheduleBot(id);
  },

  clearTimers() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  },

  /* ---------------- запись ---------------- */

  persist() {
    const snapshot = Object.fromEntries([...this.tables].map(([id, table]) => [id, clone(table)]));
    const secrets = {};
    for (const [id, state] of this.states) {
      const table = this.tables.get(id);
      if (table?.status === "playing" && getGame(table.gameId)?.rules.hasSecrets) secrets[id] = clone(state);
    }
    this._write = this._write
      .then(async () => {
        await setSetting(SETTINGS.tables, snapshot);
        await setSetting(SETTINGS.secrets, secrets);
      })
      .catch((err) => console.error(`${MODULE_ID} | не удалось записать столы`, err));
    return this._write;
  },

  /** Очередь на стол: ходы применяются строго по одному. */
  enqueue(tableId, fn) {
    const prev = this.queues.get(tableId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.queues.set(tableId, next.catch(() => {}));
    return next;
  },

  async guarded(tableId, fn) {
    if (!this.active) return { ok: false, error: "noGM" };
    return this.enqueue(tableId, async () => {
      try {
        const value = await fn();
        return { ok: true, value };
      } catch (err) {
        if (err instanceof GameError) return { ok: false, error: err.code };
        console.error(`${MODULE_ID} |`, err);
        return { ok: false, error: "internal" };
      }
    });
  },

  /* ---------------- ходы ---------------- */

  /** Ход от игрока или ведущего: { tableId, seatId, action, userId }. */
  request(data) {
    return this.guarded(data.tableId, () => this.process(data));
  },

  async process({ tableId, seatId, action, userId, asHost = false }) {
    const table = this.tables.get(tableId);
    if (!table) throw new GameError("noTable");
    const seat = table.seats.find((s) => s.id === seatId && !s.left);
    if (!seat) throw new GameError("notYourSeat");
    if (!asHost && !canUserAct(game.users.get(userId), seat)) throw new GameError("notYourSeat");
    if (table.status !== "playing") throw new GameError("finished");

    if (action?.type === "leave") return this.removeSeat(table, seat, { refund: false });

    const { rules } = getGame(table.gameId);
    const res = await runAction(rules, this.states.get(tableId), seatId, action, this.ctx(table));
    await this.commit(table, res);
  },

  ctx(table) {
    return {
      rng: Math.random,
      roll: (dice, opts = {}) => {
        const seat = table.seats.find((s) => s.id === opts.seat);
        const user = seat?.userId ? game.users.get(seat.userId) : null;
        return rollDice(dice, {
          secret: opts.secret,
          user: user?.active ? user : game.user,
          alias: seat?.name ?? table.title,
          flavor: table.title,
        });
      },
    };
  },

  async commit(table, { state, events }) {
    const { rules } = getGame(table.gameId);
    this.states.set(table.id, state);
    table.view = clone(rules.publicView(state));
    table.rev += 1;
    for (const ev of events) table.events.push({ ...ev, seq: ++table.seq });
    if (table.events.length > EVENT_LIMIT) table.events.splice(0, table.events.length - EVENT_LIMIT);
    table.stake.pot = potOf(table);

    const result = rules.result(state);
    if (result) await this.finish(table, result);

    await this.persist();
    this.pushPrivates(table);
    this.scheduleBot(table.id);
  },

  /* ---------------- ставки и итог ---------------- */

  async collect(table) {
    const s = table.stake;
    if (!s.amount) return;
    const fromSheet = [];
    const onHouse = [];
    for (const seat of table.seats) {
      const ok = paysFromSheet(table, seat) && (await charge(seatActor(seat), s.amount, s.coin));
      s.paid[seat.id] = Boolean(ok);
      (ok ? fromSheet : onHouse).push(seat.name);
    }
    if (!setting(SETTINGS.announce)) return;
    const lines = [
      t("Chat.stakes", {
        title: esc(table.title),
        stake: money(s.amount, s.coin),
        pot: money(s.amount * table.seats.length, s.coin),
      }),
    ];
    if (fromSheet.length) lines.push(t("Chat.fromSheet", { names: esc(fromSheet.join(", ")) }));
    if (onHouse.length && isDnd5e()) lines.push(t("Chat.onHouse", { names: esc(onHouse.join(", ")) }));
    ChatMessage.create({ content: `<p>${lines.join("<br>")}</p>`, speaker: { alias: table.title } });
  },

  async finish(table, result) {
    table.status = "finished";
    table.result = result;
    const s = table.stake;
    const payout = { pot: 0, share: 0, coin: s.coin, draw: !result.winners.length, winners: [], manual: [] };

    if (s.amount) {
      // Ставки сверх входной (покер) списываем сейчас: кто сколько доложил за партию.
      for (const seat of table.seats) {
        const extra = result.extra?.[seat.id] ?? table.view?.leftBets?.[seat.id] ?? 0;
        if (!extra) continue;
        const ok = paysFromSheet(table, seat) && (await charge(seatActor(seat), extra, s.coin));
        if (!ok && paysFromSheet(table, seat)) payout.manual.push({ seatId: seat.id, owes: extra });
      }
      payout.pot = potOf(table);
      if (payout.draw) {
        await this.refundAll(table);
      } else {
        payout.share = Math.floor(payout.pot / result.winners.length);
        for (const seatId of result.winners) {
          const seat = table.seats.find((x) => x.id === seatId);
          const paid = seat && paysFromSheet(table, seat) && (await pay(seatActor(seat), payout.share, s.coin));
          payout.winners.push({ seatId, paid: Boolean(paid) });
        }
      }
    } else {
      payout.winners = result.winners.map((seatId) => ({ seatId, paid: false }));
    }
    table.payout = payout;
    this.states.delete(table.id);
    if (setting(SETTINGS.announce)) this.announce(table);
  },

  /** Вернуть входные ставки тем, с кого они сняты с листа. */
  async refundAll(table) {
    const s = table.stake;
    for (const seat of table.seats) {
      if (!s.paid[seat.id]) continue;
      await pay(seatActor(seat), s.amount, s.coin);
      s.paid[seat.id] = false;
    }
  },

  announce(table) {
    const { result, payout } = table;
    const entry = getGame(table.gameId);
    const name = (id) => table.seats.find((x) => x.id === id)?.name ?? "?";
    const gameName = t(`Game.${entry.id}.name`);
    const winners = result.winners.map(name);
    const head = winners.length
      ? t("Chat.wins", { names: esc(winners.join(", ")), game: esc(gameName) })
      : t("Chat.draw", { game: esc(gameName) });
    const first = table.seats.find((x) => x.id === result.winners[0]) ?? table.seats[0];
    const rows = [];
    if (table.stake.amount) {
      const bank = money(payout.pot, payout.coin);
      const to = payout.draw
        ? t("Chat.potReturned")
        : winners.length > 1
          ? t("Chat.potSplit", { share: money(payout.share, payout.coin) })
          : esc(winners[0]);
      rows.push(`<div><span>${t("Chat.pot")}</span><b>${bank} → ${to}</b></div>`);
      const manual = payout.winners.filter((w) => !w.paid).map((w) => name(w.seatId));
      if (manual.length && isDnd5e()) rows.push(`<div><span>${t("Chat.manual")}</span><b>${esc(manual.join(", "))}</b></div>`);
    }
    const scores = Object.entries(result.scores ?? {})
      .filter(([id]) => table.seats.some((x) => x.id === id))
      .sort((a, b) => b[1] - a[1]);
    for (const [id, score] of scores) rows.push(`<div><span>${esc(name(id))}</span><b>${score}</b></div>`);

    const content = `
      <div class="tavern-games tg-chat" data-tg-theme="${table.theme}">
        <div class="tg-chatcard">
          <div class="tg-chatcard__head">
            <span class="tg-portrait tg-portrait--sm"><img src="${esc(first?.img ?? "")}" alt=""></span>
            <div><b>${head}</b><span>${esc(table.title)} · ${plural(table.seats.length, "Seats")}</span></div>
          </div>
          <div class="tg-chatcard__body">${rows.join("")}</div>
        </div>
      </div>`;
    ChatMessage.create({ content, speaker: { alias: table.title } });
  },

  /** Стол нельзя доиграть (потеряно скрытое состояние): закрываем и возвращаем ставки. */
  abort(table) {
    table.status = "finished";
    table.result = { winners: [], draw: true, aborted: true };
    table.payout = { pot: 0, share: 0, coin: table.stake.coin, draw: true, winners: [], manual: [] };
    table.events.push({ type: "aborted", seq: ++table.seq });
    table.rev += 1;
    this.refundAll(table).then(() => this.persist());
    ui.notifications.warn(t("Notify.aborted", { title: table.title }));
  },

  /* ---------------- управление столами (ведущий) ---------------- */

  /** config: { gameId, title, theme, seats, options, stake: { amount, coin, fromSheets, npcPays }, hidden } */
  createTable(config) {
    const id = foundry.utils.randomID(10);
    return this.guarded(id, async () => {
      const entry = getGame(config.gameId);
      if (!entry) throw new GameError("noGame");
      const { rules } = entry;
      const seats = config.seats.map((s) => ({ ...s, left: false }));
      if (seats.length < rules.seats.min || seats.length > rules.seats.max) throw new GameError("seatCount");

      const table = {
        id,
        gameId: rules.id,
        title: config.title || t(`Game.${rules.id}.name`),
        theme: config.theme ?? setting(SETTINGS.defaultTheme),
        status: "playing",
        hidden: Boolean(config.hidden),
        createdAt: Date.now(),
        seats,
        options: rules.normalizeOptions(config.options),
        stake: {
          amount: Math.max(0, Math.floor(Number(config.stake?.amount) || 0)),
          coin: config.stake?.coin ?? "chips",
          fromSheets: Boolean(config.stake?.fromSheets),
          npcPays: config.stake?.npcPays === "sheet" ? "sheet" : "house",
          paid: {},
          refunded: [],
          pot: 0,
        },
        rev: 0,
        seq: 0,
        events: [],
        view: null,
        result: null,
        payout: null,
        summon: 0,
      };
      await this.collect(table);
      const state = await rules.setup({ seatIds: seats.map((s) => s.id), options: table.options, ctx: this.ctx(table) });
      this.tables.set(id, table);
      await this.commit(table, { state, events: [{ type: "start" }] });
      return id;
    });
  },

  removeTable(tableId, { refund = false } = {}) {
    return this.guarded(tableId, async () => {
      const table = this.tables.get(tableId);
      if (!table) return;
      clearTimeout(this.timers.get(tableId));
      if (refund && table.status === "playing") await this.refundAll(table);
      this.tables.delete(tableId);
      this.states.delete(tableId);
      await this.persist();
    });
  },

  setHidden(tableId, hidden) {
    return this.guarded(tableId, async () => {
      const table = this.tables.get(tableId);
      if (!table) return;
      table.hidden = hidden;
      await this.persist();
    });
  },

  /** Вернуть окно тем, кто закрыл его крестиком. */
  summon(tableId) {
    return this.guarded(tableId, async () => {
      const table = this.tables.get(tableId);
      if (!table) return;
      table.summon += 1;
      await this.persist();
    });
  },

  /** Выставить место из-за стола (или игрок встал сам). */
  kick(tableId, seatId, { refund = false } = {}) {
    return this.guarded(tableId, async () => {
      const table = this.tables.get(tableId);
      const seat = table?.seats.find((s) => s.id === seatId && !s.left);
      if (!seat) throw new GameError("notYourSeat");
      await this.removeSeat(table, seat, { refund });
    });
  },

  async removeSeat(table, seat, { refund }) {
    const s = table.stake;
    if (refund && s.amount) {
      if (s.paid[seat.id]) await pay(seatActor(seat), s.amount, s.coin);
      s.paid[seat.id] = false;
      s.refunded.push(seat.id);
    }
    seat.left = true;
    if (table.status !== "playing") {
      await this.persist();
      return;
    }
    const { rules } = getGame(table.gameId);
    const res = await rules.removeSeat(this.states.get(table.id), seat.id, this.ctx(table));
    await this.commit(table, res);
  },

  /** Сходить за текущее место так, как сходил бы бот (игрок отошёл, партия застряла). */
  autoMove(tableId) {
    return this.guarded(tableId, () => this.botMove(tableId));
  },

  /** Та же игра теми же местами. */
  async rematch(tableId) {
    const table = this.tables.get(tableId);
    if (!table) return { ok: false, error: "noTable" };
    // Сначала убеждаемся, что мест хватает, — иначе старый стол пропал бы зря.
    const staying = table.seats.filter((s) => !s.left).length;
    if (staying < getGame(table.gameId).rules.seats.min) return { ok: false, error: "seatCount" };
    const config = {
      gameId: table.gameId,
      title: table.title,
      theme: table.theme,
      hidden: table.hidden,
      options: table.options,
      stake: table.stake,
      seats: table.seats.filter((s) => !s.left).map((s) => ({ ...s })),
    };
    await this.removeTable(tableId);
    return this.createTable(config);
  },

  /* ---------------- боты ---------------- */

  scheduleBot(tableId) {
    clearTimeout(this.timers.get(tableId));
    const table = this.tables.get(tableId);
    if (!this.active || !table || table.status !== "playing") return;
    const { rules } = getGame(table.gameId);
    const seatId = rules.currentSeat(this.states.get(tableId));
    const seat = table.seats.find((s) => s.id === seatId);
    if (seat?.control !== "bot") return;
    const rev = table.rev;
    const delay = setting(SETTINGS.botDelay) * (0.75 + Math.random() * 0.6);
    this.timers.set(
      tableId,
      setTimeout(() => {
        this.guarded(tableId, async () => {
          if (this.tables.get(tableId)?.rev !== rev) return;
          await this.botMove(tableId);
        });
      }, delay),
    );
  },

  async botMove(tableId) {
    const table = this.tables.get(tableId);
    if (!table || table.status !== "playing") throw new GameError("finished");
    const entry = getGame(table.gameId);
    const { rules } = entry;
    const state = this.states.get(tableId);
    const seatId = rules.currentSeat(state);
    const seat = table.seats.find((s) => s.id === seatId);
    if (!seat) throw new GameError("finished");

    let action = null;
    try {
      action = entry.bot({
        view: clone(rules.publicView(state)),
        mine: clone(rules.privateView(state, seatId)),
        seatId,
        options: table.options,
        temperament: temperament(seat.temperament),
        rng: Math.random,
      });
    } catch (err) {
      console.error(`${MODULE_ID} | бот ошибся`, err);
    }
    if (!action || rules.validate(state, seatId, action)) action = rules.legalActions(state, seatId)[0];
    if (!action) throw new GameError("noMove");
    await this.process({ tableId, seatId, action, asHost: true });
  },

  /* ---------------- скрытое ---------------- */

  /** Личный вид места — для окна самого ведущего. */
  privateFor(tableId, seatId) {
    const table = this.tables.get(tableId);
    const state = this.states.get(tableId);
    if (!this.active || !table || !state) return null;
    return getGame(table.gameId).rules.privateView(state, seatId);
  },

  /** Разослать владельцам мест их скрытое (каждому — только своё). */
  pushPrivates(table, onlyUserId = null) {
    const { rules } = getGame(table.gameId);
    const state = this.states.get(table.id);
    if (!rules.hasSecrets || !state) return;
    for (const seat of table.seats) {
      if (seat.left || seat.control !== "user" || !seat.userId) continue;
      if (onlyUserId && seat.userId !== onlyUserId) continue;
      const user = game.users.get(seat.userId);
      if (!user?.active || user.isSelf) continue;
      user
        .query(QUERY.private, { tableId: table.id, seatId: seat.id, rev: table.rev, view: rules.privateView(state, seat.id) })
        .catch(() => {});
    }
  },

  /** Игрок вошёл или открыл окно заново — дослать ему его скрытое. */
  sync(userId) {
    if (!this.active) return false;
    for (const table of this.tables.values()) {
      if (table.status === "playing") this.pushPrivates(table, userId);
    }
    return true;
  },
};
