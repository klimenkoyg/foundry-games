/* «Кости лжеца» — стаканчики, ставки и вскрытие.
   Свои кости игрок получает личным видом (ctx.mine); чужие видны только при вскрытии.
   Ведущий может заглянуть под стаканчики — у него есть полное состояние. */

import { allowedFaces, isHigherBid } from "../../core/games/liars.mjs";
import { tpl } from "../constants.mjs";
import { dieHtml } from "../handlebars.mjs";
import { esc, plural, t } from "../i18n.mjs";
import { cls, isFresh } from "./common.mjs";

/** «5 пятёрок» */
const bidText = (q, f) => `${q} ${plural(q, `Liars.face.${f}`)}`;

const bidHtml = (bid) => (bid ? { q: bid.q, die: dieHtml(bid.f) } : null);

/** Ставка, набранная в окне; при каждой новой чужой ставке — минимальное повышение. */
function draft(ctx) {
  const { view, ui } = ctx;
  const faces = allowedFaces(view.rules);
  const key = `${view.round}:${view.history.length}:${ctx.acting?.id}`;
  if (ui.key !== key) {
    ui.key = key;
    const bid = view.bid;
    if (bid) {
      const higher = faces.find((f) => f > bid.f);
      ui.q = higher ? bid.q : bid.q + 1;
      ui.f = higher ?? faces[0];
    } else {
      // Открывающая ставка: своя самая частая грань.
      const cup = ctx.mine?.cup ?? [];
      const best = faces
        .map((f) => [f, cup.filter((v) => v === f || (view.rules.onesWild && v === 1)).length])
        .sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
      ui.f = best?.[0] ?? faces[0];
      ui.q = Math.max(1, best?.[1] ?? 1);
    }
    ui.q = Math.min(ui.q, view.totalDice);
  }
  return ui;
}

export default {
  id: "liars",
  icon: "fa-solid fa-mask",
  template: tpl("games/liars.hbs"),
  rollEvents: ["round"],
  noRail: true,

  rulesData: (o) => ({
    dice: o.dice,
    wild: t(o.onesWild ? "Liars.rules.wildOn" : "Liars.rules.wildOff"),
    spot: t(o.spotOn ? "Liars.rules.spotOn" : "Liars.rules.spotOff"),
  }),

  subtitle(ctx) {
    const { view } = ctx;
    const parts = [t("Liars.sub", { round: view.round, total: plural(view.totalDice, "Dice") })];
    if (view.rules.onesWild) parts.push(t("Liars.subWild"));
    return parts.join(" · ");
  },

  gmButtons(ctx) {
    return [{ op: "peek", icon: ctx.ui.peek ? "fa-eye-slash" : "fa-eye", label: t(ctx.ui.peek ? "Liars.unpeek" : "Liars.peek"), pressed: ctx.ui.peek }];
  },

  board(ctx) {
    const { view, table } = ctx;
    const rules = view.rules;
    const rv = view.phase === "reveal" ? view.reveal : null;
    const isMatch = (v) => rv && (v === rv.bid.f || (rules.onesWild && v === 1));
    const revealDice = (values) => values.map((v) => dieHtml(v, { cls: isMatch(v) && "is-match" })).join("");
    const fresh = isFresh(ctx, "round") || isFresh(ctx, "start");
    const meId = ctx.me?.id;

    const opps = table.seats
      .filter((s) => s.id !== meId && (s.id in view.counts || !s.left))
      .map((s) => {
        const count = view.counts[s.id] ?? 0;
        const last = [...view.history].reverse().find((b) => b.seat === s.id);
        const isTop = last && view.bid && view.bid.seat === s.id && view.bid.q === last.q && view.bid.f === last.f;
        let shown = null;
        if (rv?.cups[s.id]) shown = revealDice(rv.cups[s.id]);
        else if (ctx.isGM && ctx.ui.peek) {
          const cup = ctx.privateOf(s.id)?.cup;
          if (cup) shown = cup.map((v) => dieHtml(v)).join("");
        }
        return {
          id: s.id,
          name: s.name,
          img: s.img,
          count,
          out: count === 0,
          isTurn: view.current === s.id && !view.finished,
          thinking: view.current === s.id && s.control === "bot" && !view.finished,
          bubble: last && !rv ? { ...bidHtml(last), old: !isTop } : null,
          shown,
          peek: Boolean(shown) && !rv,
          pips: Array.from({ length: rules.dice }, (_, i) => i < count),
        };
      });

    // Центр: старшая ставка или итог вскрытия.
    const topBid = rv ? rv.bid : view.bid;
    let verdict = null;
    if (rv) {
      const caller = esc(ctx.name(rv.caller));
      const bidder = esc(ctx.name(rv.bid.seat));
      const actual = t("Liars.actual", {
        count: bidText(rv.actual, rv.bid.f),
        wild: rules.onesWild ? t("Liars.withOnes") : "",
      });
      let outcome;
      if (rv.call === "spotOn") {
        outcome = rv.actual === rv.bid.q ? t(rv.gainer ? "Liars.spotGain" : "Liars.spotRight", { name: caller }) : t("Liars.spotMiss", { name: caller });
      } else if (rv.actual >= rv.bid.q) outcome = t("Liars.honest", { name: caller });
      else outcome = rv.loser ? t("Liars.bluff", { name: bidder }) : t("Liars.bluffGone");
      verdict = `${actual} ${outcome}`;
    }

    const myCup = rv?.cups[meId] ?? ctx.mine?.cup ?? null;
    const myCount = meId ? (view.counts[meId] ?? 0) : 0;

    const buttons = [];
    let controls = null;
    if (ctx.canAct && view.phase === "reveal") {
      buttons.push({ op: "next", icon: "fa-rotate", cls: "tg-btn--primary", label: t("Liars.next") });
    } else if (ctx.canAct && view.phase === "bidding") {
      const d = draft(ctx);
      const faces = allowedFaces(rules);
      const valid = d.q >= 1 && d.q <= view.totalDice && faces.includes(d.f) && isHigherBid(view.bid, d.q, d.f);
      const canCall = Boolean(view.bid) && view.bid.seat !== ctx.acting.id;
      controls = {
        q: d.q,
        faces: faces.map((f) => dieHtml(f, { button: true, op: "face", arg: f, pressed: f === d.f, label: t(`Liars.face.${f}.other`) })).join(""),
        caption: view.bid ? t("Liars.raiseOver", { bid: bidText(view.bid.q, view.bid.f) }) : t("Liars.openBid"),
        invalid: Boolean(view.bid) && !valid,
        bidLabel: bidText(d.q, d.f),
        bidDisabled: !valid,
        canCall,
        spotOn: rules.spotOn,
        answer: view.bid ? t("Liars.answer", { name: esc(ctx.name(view.bid.seat)) }) : "",
      };
    }

    return {
      revealing: Boolean(rv),
      opps,
      centerLabel: topBid ? t("Liars.bidOf", { name: ctx.name(topBid.seat) }) : t("Liars.noBid"),
      bid: bidHtml(topBid),
      verdict,
      mine: myCup
        ? myCup.map((v) => dieHtml(v, { cls: cls("tg-die--sm", rv ? isMatch(v) && "is-match" : fresh && "is-rolling") })).join("")
        : null,
      mineOut: Boolean(meId) && myCount === 0,
      myName: ctx.me?.name,
      controls,
      buttons,
      status: !ctx.canAct && ctx.current ? t("Status.turnOf", { name: esc(ctx.current.name) }) : null,
    };
  },

  onAction(ctx, op, arg) {
    const { view } = ctx;
    switch (op) {
      case "stepQ": {
        const d = draft(ctx);
        d.q = Math.min(view.totalDice, Math.max(1, d.q + Number(arg)));
        return ctx.rerender();
      }
      case "face":
        draft(ctx).f = Number(arg);
        return ctx.rerender();
      case "bid": {
        const d = draft(ctx);
        return ctx.send({ type: "bid", q: d.q, f: d.f });
      }
      case "challenge":
      case "spotOn":
      case "next":
        return ctx.send({ type: op });
      case "peek":
        ctx.ui.peek = !ctx.ui.peek;
        return ctx.app.render();
    }
  },

  logLine(ctx, ev, name) {
    switch (ev.type) {
      case "bid":
        return t("Log.liars.bid", { name, bid: bidText(ev.q, ev.f) });
      case "challenge":
        return t("Log.liars.challenge", { name });
      case "spotOn":
        return t("Log.liars.spotOn", { name });
      case "revealed": {
        const who = ev.loser ?? ev.gainer;
        const line = t("Log.liars.revealed", { count: bidText(ev.actual, ev.bid.f) });
        if (!who) return line;
        return `${line} ${t(ev.loser ? "Log.liars.loses" : "Log.liars.gains", { name: `<b>${esc(ctx.name(who))}</b>` })}`;
      }
      case "out":
        return t("Log.liars.out", { name });
      case "round":
        return t("Log.liars.round", { n: ev.round });
      case "won":
        return t("Log.liars.won", { name });
      default:
        return null;
    }
  },
};
