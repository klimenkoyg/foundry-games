/* «Двадцать одно» — поле и действия. */

import { DICE } from "../../core/games/tw.mjs";
import { tpl } from "../constants.mjs";
import { polyHtml } from "../handlebars.mjs";
import { esc, plural, t } from "../i18n.mjs";
import { cls, isFresh } from "./common.mjs";

const emptyHand = () => ({ rolled: [], total: 0, stood: false, bust: false, done: false });

export default {
  id: "tw",
  icon: "fa-solid fa-dice-d20",
  template: tpl("games/tw.hbs"),
  rollEvents: ["took"],

  rulesData: (o) => ({ limit: o.limit, wins: o.wins, tie: t(o.fewerDice ? "Tw.rules.tieOn" : "Tw.rules.tieOff") }),

  subtitle(ctx) {
    const { view } = ctx;
    return t("Tw.sub", { round: view.round, wins: plural(view.rules.wins, "Tw.winsCount"), limit: view.rules.limit });
  },

  seatInfo(ctx, seat) {
    const { view } = ctx;
    const h = view.hands?.[seat.id];
    if (!h) return {};
    const chips = [];
    if (h.bust) chips.push({ icon: "fa-xmark", text: t("Tw.bust"), cls: "tg-chip--danger" });
    else if (h.done) chips.push({ icon: "fa-hand", text: t("Tw.stood"), cls: "tg-chip--success" });
    return {
      pips: Array.from({ length: view.rules.wins }, (_, i) => i < (view.wins[seat.id] ?? 0)),
      chips,
      score: h.rolled.length || h.done ? h.total : null,
      scoreStruck: h.bust,
      // У нижнего места рука и так лежит на сукне.
      extra: seat.id === ctx.me?.id ? null : h.rolled.map((r) => polyHtml(r.sides, { value: r.value, sm: true })).join(""),
    };
  },

  board(ctx) {
    const { view } = ctx;
    const limit = view.rules.limit;
    // Свою руку игрок видит всегда; зритель и ведущий — руку того, кто ходит.
    const mainId = ctx.me?.id ?? view.current ?? view.order[0];
    const h = view.hands[mainId] ?? emptyHand();
    const myTurn = ctx.canAct && ctx.acting.id === mainId;
    const took = isFresh(ctx, "took", (e) => e.seat === mainId);
    const used = new Set(h.rolled.map((r) => r.sides));

    const best = view.order
      .filter((id) => id !== mainId && view.hands[id]?.done && !view.hands[id].bust)
      .sort((a, b) => view.hands[b].total - view.hands[a].total)[0];

    let status = null;
    if (h.bust) status = t("Tw.youBust", { total: h.total });
    else if (myTurn) status = h.rolled.length ? t("Tw.more", { total: h.total }) : t("Tw.first");

    const last = view.lastRound;
    let statusSub = null;
    if (last && !h.rolled.length && !view.finished) {
      statusSub = last.winner
        ? t("Tw.lastRound", { round: last.round ?? view.round - 1, name: esc(ctx.name(last.winner)), total: last.totals[last.winner] })
        : t("Tw.lastDraw", { round: last.round ?? view.round - 1 });
    }

    return {
      handLabel: ctx.mySeat?.id === mainId ? t("Tw.yourHand") : t("Tw.handOf", { name: ctx.name(mainId) }),
      rolled: h.rolled
        .map((r, i) => polyHtml(r.sides, { value: r.value, cls: cls(took && i === h.rolled.length - 1 && "is-rolling") }))
        .join(""),
      total: h.total,
      limit,
      bust: h.bust,
      track: Math.min(1, h.total / limit),
      note: best ? t("Tw.best", { name: ctx.name(best), total: view.hands[best].total }) : "",
      pool: DICE.map((sides) =>
        polyHtml(sides, {
          button: true,
          op: "take",
          arg: sides,
          cap: true,
          value: used.has(sides) ? "" : "?",
          disabled: used.has(sides) || !myTurn || h.done,
          cls: cls(used.has(sides) && "is-spent"),
        }),
      ).join(""),
      status: status ?? (!ctx.canAct && ctx.current ? t("Status.turnOf", { name: esc(ctx.current.name) }) : null),
      statusSub,
      buttons: myTurn && !h.done ? [{ op: "stand", icon: "fa-hand", cls: "tg-btn--primary", label: t("Tw.stand") }] : [],
    };
  },

  onAction(ctx, op, arg) {
    if (op === "take") ctx.send({ type: "take", sides: Number(arg) });
    else if (op === "stand") ctx.send({ type: "stand" });
  },

  logLine(ctx, ev, name) {
    switch (ev.type) {
      case "took":
        return t(ev.bust ? "Log.tw.bust" : "Log.tw.took", { name, die: t("Die.kind", { n: ev.sides }), value: ev.value, total: ev.total });
      case "stood":
        return t("Log.tw.stood", { name, total: ev.total });
      case "roundWon":
        if (!ev.seat) return t("Log.tw.roundDraw");
        return t(ev.byDice ? "Log.tw.roundDice" : "Log.tw.round", { name, total: ev.totals[ev.seat] });
      case "won":
        return t("Log.tw.won", { name });
      default:
        return null;
    }
  },
};
