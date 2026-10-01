/* «Кости» (Farkle) — поле и действия. Выбор костей живёт в окне, к ведущему уходит уже готовый ход. */

import { scoreSelection } from "../../core/games/farkle.mjs";
import { tpl } from "../constants.mjs";
import { dieHtml } from "../handlebars.mjs";
import { esc, plural, t } from "../i18n.mjs";
import { cls, inlineDice, isFresh, lastEvent } from "./common.mjs";

/** Выбор действителен только для того броска, на котором сделан. */
function selection(ctx) {
  const { view, ui } = ctx;
  const key = `${view.current}:${view.turn.rolls}:${ctx.table.id}`;
  if (ui.key !== key) {
    ui.key = key;
    ui.sel = [];
  }
  return ui.sel;
}

export default {
  id: "farkle",
  icon: "fa-solid fa-dice-five",
  template: tpl("games/farkle.hbs"),
  rollEvents: ["rolled"],

  rulesData: (o) => ({
    target: o.target,
    entry: o.entry,
    pairs: t(o.threePairs ? "Farkle.rules.pairsOn" : "Farkle.rules.pairsOff"),
    straights: t(o.straights ? "Farkle.rules.straightsOn" : "Farkle.rules.straightsOff"),
  }),

  subtitle(ctx) {
    const { rules } = ctx.view;
    const base = t("Farkle.sub", { target: rules.target });
    return rules.entry > 0 ? `${base} · ${t("Farkle.subEntry", { entry: rules.entry })}` : base;
  },

  seatInfo(ctx, seat) {
    const { view } = ctx;
    if (!(seat.id in (view.scores ?? {}))) return {};
    const score = view.scores[seat.id];
    return {
      score,
      scoreSub: t("Farkle.of", { target: view.rules.target }),
      progress: Math.min(1, score / view.rules.target),
      chips: view.rules.entry > 0 && !view.entered[seat.id] ? [{ icon: "fa-door-closed", text: t("Farkle.notEntered") }] : [],
    };
  },

  board(ctx) {
    const { view, table } = ctx;
    const turn = view.turn;
    const rules = view.rules;
    const sel = selection(ctx);
    const rolled = isFresh(ctx, "rolled");
    const values = sel.map((i) => turn.dice[i]);
    const score = values.length ? scoreSelection(values, rules) : 0;
    const valid = score > 0;
    const remaining = turn.dice.length - sel.length;
    const total = turn.points + score;
    const seatId = view.current;
    const belowEntry = seatId && !view.entered[seatId] && total < rules.entry;

    // Пусто: кости прошлого хода лежат потухшими, пока новый игрок не бросил.
    const farkle = !turn.dice.length && ctx.playing ? lastEvent(table, ["farkle", "banked", "start"]) : null;
    const showFarkle = farkle?.type === "farkle";

    let dice;
    if (showFarkle) dice = farkle.values.map((v, i) => dieHtml(v, { scatter: farkle.seq * 7 + i, cls: "is-spent" })).join("");
    else {
      dice = turn.dice
        .map((v, i) =>
          dieHtml(v, {
            button: ctx.canAct,
            op: "toggle",
            arg: i,
            scatter: turn.rolls * 31 + table.seats.length * 7 + i + (view.current?.length ?? 0),
            cls: cls(sel.includes(i) && "is-selected", rolled && "is-rolling"),
          }),
        )
        .join("");
    }

    let hint;
    let invalid = false;
    if (showFarkle) hint = t("Farkle.bust", { name: esc(ctx.name(farkle.seat)), lost: farkle.lost });
    else if (!turn.dice.length) hint = ctx.canAct ? t("Farkle.yourRoll") : "";
    else if (!ctx.canAct) hint = "";
    else if (!values.length) hint = t("Farkle.pick");
    else if (!valid) {
      hint = t("Farkle.invalid");
      invalid = true;
    } else hint = t("Farkle.selected", { score });

    const buttons = [];
    if (ctx.canAct) {
      if (!turn.dice.length) {
        buttons.push({ op: "roll", icon: "fa-dice", cls: "tg-btn--primary", label: t("Farkle.rollSix") });
      } else {
        buttons.push({
          op: "bank",
          icon: "fa-feather-pointed",
          label: t("Farkle.bank"),
          sub: valid ? total : turn.points,
          disabled: !valid || belowEntry,
          tip: valid && belowEntry ? t("Farkle.belowEntry", { entry: rules.entry }) : null,
        });
        buttons.push({
          op: "keepRoll",
          icon: "fa-dice",
          cls: "tg-btn--primary",
          label: remaining === 0 && valid ? t("Farkle.rollAll") : plural(Math.max(remaining, 1), "Farkle.keepRoll"),
          disabled: !valid,
        });
      }
    }

    return {
      dice,
      hint,
      invalid,
      bust: showFarkle,
      kept: turn.kept.map((v) => dieHtml(v, { cls: "tg-die--sm" })).join(""),
      points: turn.points,
      buttons,
    };
  },

  onAction(ctx, op, arg) {
    const sel = selection(ctx);
    if (op === "toggle") {
      const i = Number(arg);
      const at = sel.indexOf(i);
      if (at >= 0) sel.splice(at, 1);
      else sel.push(i);
      ctx.rerender();
    } else if (op === "roll") {
      ctx.send({ type: "roll" });
    } else if (op === "keepRoll" || op === "bank") {
      ctx.send({ type: "keep", indices: [...sel], then: op === "bank" ? "bank" : "roll" });
    }
  },

  logLine(ctx, ev, name) {
    switch (ev.type) {
      case "rolled":
        return false;
      case "kept":
        return t("Log.farkle.kept", { name, dice: inlineDice(ev.values), score: ev.score });
      case "farkle":
        return t("Log.farkle.bust", { name, lost: ev.lost, dice: inlineDice(ev.values) });
      case "banked":
        return t("Log.farkle.banked", { name, points: ev.points, total: ev.total });
      case "won":
        return t("Log.farkle.won", { name, total: ev.total });
      default:
        return null;
    }
  },
};
