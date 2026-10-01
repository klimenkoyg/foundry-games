/* «Корабль, капитан и команда» — поле и действия. */

import { sum } from "../../core/util.mjs";
import { tpl } from "../constants.mjs";
import { dieHtml } from "../handlebars.mjs";
import { plural, t } from "../i18n.mjs";
import { cls, inlineDice, isFresh, lastEvent } from "./common.mjs";

const SLOTS = [
  { need: 6, key: "ship", icon: "fa-sailboat" },
  { need: 5, key: "captain", icon: "fa-user-tie" },
  { need: 4, key: "crew", icon: "fa-people-group" },
];

export default {
  id: "scc",
  icon: "fa-solid fa-anchor",
  template: tpl("games/scc.hbs"),
  rollEvents: ["rolled"],

  rulesData: (options) => ({ rolls: options.rolls }),

  subtitle: (ctx) => t("Scc.sub", { rolls: plural(ctx.view.maxRolls, "Scc.rollsCount") }),

  seatInfo(ctx, seat) {
    const { view } = ctx;
    const h = view.hands?.[seat.id];
    if (!h || !view.contenders.includes(seat.id)) return { out: !ctx.finished && view.round > 1 };
    if (!h.done) return {};
    if (h.score > 0) return { score: h.score, scoreSub: t("Scc.cargo") };
    return { score: "—", chips: [{ icon: "fa-water", text: t("Scc.noShip"), cls: "tg-chip--danger" }] };
  },

  board(ctx) {
    const { view, table } = ctx;
    const showId = view.current ?? view.winner ?? view.order[0];
    const h = view.hands[showId] ?? { rolls: 0, dice: [], ship: false, captain: false, crew: false };
    const rolled = isFresh(ctx, "rolled", (e) => e.seat === showId);
    const cargo = h.crew ? sum(h.dice) : null;
    const left = view.maxRolls - h.rolls;

    let need;
    if (ctx.finished) need = t("Scc.over");
    else if (!h.ship) need = t("Scc.need.ship");
    else if (!h.captain) need = t("Scc.need.captain");
    else if (!h.crew) need = t("Scc.need.crew");
    else need = t("Scc.crewReady", { left: plural(left, "Scc.rollsLeft") });

    // Рука только началась — показываем, чем кончился прошлый ход.
    const prev = h.rolls === 0 ? lastEvent(table, ["handDone"]) : null;
    const prevRoll = prev ? lastEvent(table, ["rolled"]) : null;

    const buttons = [];
    if (ctx.canAct) {
      buttons.push({ op: "stop", icon: "fa-box", label: h.crew ? t("Scc.keep", { n: cargo }) : t("Scc.keepNone"), disabled: !h.crew || h.rolls === 0 });
      buttons.push({
        op: "roll",
        icon: "fa-dice",
        cls: "tg-btn--primary",
        label: h.crew ? t("Scc.rerollCargo") : plural(5 - Number(h.ship) - Number(h.captain) - Number(h.crew), "Scc.roll"),
      });
    }

    return {
      rollPips: Array.from({ length: view.maxRolls }, (_, i) => i < h.rolls),
      need,
      slots: SLOTS.map((s) => ({ ...s, filled: h[s.key], name: t(`Scc.slot.${s.key}`), die: dieHtml(s.need) })),
      crew: h.crew,
      cargoDice: h.crew ? h.dice.map((v) => dieHtml(v, { cls: cls("tg-die--sm", rolled && "is-rolling") })).join("") : "",
      cargoSum: cargo ?? "—",
      freeDice: h.crew ? "" : h.dice.map((v, i) => dieHtml(v, { scatter: table.seq * 7 + i, cls: rolled && "is-rolling" })).join(""),
      prev: prev && prevRoll && prevRoll.seat === prev.seat
        ? t(prev.score > 0 ? "Scc.prevCargo" : "Scc.prevNone", { name: ctx.name(prev.seat), n: prev.score })
        : null,
      buttons,
    };
  },

  onAction(ctx, op) {
    if (op === "roll") ctx.send({ type: "roll" });
    else if (op === "stop") ctx.send({ type: "stop" });
  },

  logLine(ctx, ev, name) {
    switch (ev.type) {
      case "rolled": {
        const found = ev.locked.map((v) => t(`Scc.found.${v}`)).join(", ");
        return t(found ? "Log.scc.rolledFound" : "Log.scc.rolled", { name, dice: inlineDice(ev.values), found });
      }
      case "handDone":
        return t(ev.score > 0 ? "Log.scc.cargo" : "Log.scc.noShip", { name, n: ev.score });
      case "roundTie":
        return t("Log.scc.tie", { names: ev.seats.map(ctx.name).join(", "), n: ev.score });
      case "roundVoid":
        return t("Log.scc.void");
      case "won":
        return t("Log.scc.won", { name, n: ev.score });
      default:
        return null;
    }
  },
};
