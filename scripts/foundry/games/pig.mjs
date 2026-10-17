/* «Свинья» — кубики: бросить ещё или записать. На сукне — последний бросок,
   в лотке — все броски хода, каждый своей группой. Сгоревший ход лежит потухшим, пока следующий не бросил. */

import { estimateTurns } from "../../core/bots/pig.mjs";
import { BUST, diceFor, manyDice } from "../../core/games/pig.mjs";
import { sum } from "../../core/util.mjs";
import { tpl } from "../constants.mjs";
import { dieHtml } from "../handlebars.mjs";
import { esc, plural, t } from "../i18n.mjs";
import { cls, inlineDice, isFresh, lastEvent } from "./common.mjs";

/** Кубики на сукне; в сгоревшем броске единицы в красном кольце, остальные потухли. */
const feltHtml = (values, { scatter, rolling, burned }) =>
  values
    .map((v, i) => dieHtml(v, { scatter: scatter + i * 13, cls: cls(rolling && "is-rolling", burned && (v === BUST ? "is-bust" : "is-spent")) }))
    .join("");

/** Лоток: броски хода группами; пока бросают по одному кубику — кубики крупнее. */
function trayHtml(rolls, burned) {
  const size = rolls.every((r) => r.length === 1) ? "tg-die--sm" : "tg-die--xs";
  return rolls
    .map((r) => `<span class="tg-pig__roll">${r.map((v) => dieHtml(v, { cls: cls(size, v === BUST ? "is-bust" : burned && "is-spent") })).join("")}</span>`)
    .join("");
}

/** Дольше этого — «партия может не закончиться». */
const TURN_LIMIT = 400;
/** С какого числа ходов на каждого (в девяти партиях из десяти) партия считается долгой. */
const LONG_GAME = 30;
const lengths = new Map();

/** Сколько длится партия при этих настройках — подсказка в окне сбора стола. */
function lengthNote(o, seats) {
  const key = JSON.stringify([o.target, o.dice, o.grow, o.snakeEyes, Math.max(2, seats)]);
  if (!lengths.has(key)) lengths.set(key, estimateTurns(o, seats, { limit: TURN_LIMIT }));
  const { median, long } = lengths.get(key);
  const turns = (n) => plural(n, "Pig.turnsN");
  // после «до» и «больше» — родительный падеж: «до 32 ходов», «больше 21 хода»
  const upTo = (n) => plural(n, "Pig.turnsGen");
  const limit = upTo(TURN_LIMIT);
  const max = o.maxTurns;
  if (max) {
    // Предел ходов: партия кончится не позже него.
    if (median === null || median >= max) return { icon: "fa-hourglass-end", text: t("Pig.lengthByLimit", { max: turns(max) }) };
    if (long === null || long > max) return { icon: "fa-hourglass-half", text: t("Pig.lengthCapped", { turns: turns(median), max: upTo(max) }) };
  }
  if (median !== null && long !== null && (long <= LONG_GAME || max)) {
    return { icon: "fa-hourglass-half", text: t("Pig.length", { turns: turns(median), long: upTo(long) }) };
  }
  let text;
  if (median === null) text = t("Pig.lengthEndless", { limit });
  else if (long === null) text = t("Pig.lengthMaybeEndless", { turns: turns(median), limit });
  else text = t("Pig.lengthLong", { turns: turns(median), long: upTo(long) });
  return { icon: "fa-triangle-exclamation", warn: true, text: `${text} ${t(o.snakeEyes ? "Pig.whyWipe" : "Pig.whyTarget")}` };
}

/** Кнопка броска: «Бросить кубик» или «Бросить» с числом кубиков. */
function rollButton(next, again) {
  const label = again ? t("Pig.rollMore") : next === 1 ? t("Pig.roll") : t("Pig.rollMany");
  return { op: "roll", icon: "fa-dice", cls: "tg-btn--primary", label, sub: next > 1 ? plural(next, "Pig.diceN") : null };
}

export default {
  id: "pig",
  icon: "fa-solid fa-piggy-bank",
  template: tpl("games/pig.hbs"),
  rollEvents: ["rolled"],
  // Следующий бросок бота — не раньше, чем докатится прошлый.
  minBotDelay: 800,

  rulesTerms(o) {
    const terms = [t("Pig.termTarget", { target: o.target })];
    if (o.maxTurns) terms.push(plural(o.maxTurns, "Pig.termLimit"));
    if (o.grow) terms.push(plural(o.dice, "Pig.termGrow"));
    else terms.push(o.dice === 1 ? t("Pig.termOne") : plural(o.dice, "Pig.termDice"));
    if (o.snakeEyes) terms.push(t("Pig.termWipe"));
    else if (manyDice(o)) terms.push(t("Pig.termOnes"));
    return terms;
  },

  seatingNote: (o, seats) => lengthNote(o, seats),

  subtitle(ctx) {
    const rules = ctx.view.rules;
    const bits = [t("Pig.sub", { target: rules.target })];
    if (rules.maxTurns) {
      const round = Math.min(rules.maxTurns, 1 + Math.min(...ctx.view.order.map((id) => ctx.view.turns[id] ?? 0)));
      bits.push(t("Pig.subRound", { round, max: rules.maxTurns }));
    }
    if (rules.grow) bits.push(t("Pig.subGrow", { n: rules.dice }));
    else if (rules.dice > 1) bits.push(plural(rules.dice, "Pig.diceN"));
    bits.push(t(rules.snakeEyes ? "Pig.subWipe" : "Pig.subOne"));
    return bits.join(" · ");
  },

  seatInfo(ctx, seat) {
    const { view } = ctx;
    if (!(seat.id in (view.scores ?? {}))) return {};
    const score = view.scores[seat.id];
    return { score, scoreSub: t("Pig.of", { target: view.rules.target }), progress: Math.min(1, score / view.rules.target) };
  },

  board(ctx) {
    const { view, table } = ctx;
    const { turn, rules } = view;
    const rolled = isFresh(ctx, "rolled");
    // Ход ещё не начат: показываем, чем кончился прошлый.
    const prev = !turn.rolls.length && ctx.playing ? lastEvent(table, ["bust", "held", "start"]) : null;
    const bust = prev?.type === "bust" ? prev : null;
    const scatter = table.seq * 7 + turn.rolls.length;
    const next = diceFor(rules, turn.rolls.length);

    if (bust) {
      const values = bust.rolls.at(-1);
      const name = esc(ctx.name(bust.seat));
      let hint;
      if (bust.wiped) hint = t("Pig.wipe", { name, lost: bust.wiped + bust.lost });
      else hint = t(bust.lost ? "Pig.bust" : "Pig.bustZero", { name, lost: bust.lost });
      return {
        die: feltHtml(values, { scatter, rolling: rolled, burned: true }),
        many: values.length > 1,
        hint,
        isBust: true,
        rolls: trayHtml(bust.rolls, true),
        points: bust.lost,
        burned: true,
        buttons: ctx.canAct ? [rollButton(next, false)] : [],
      };
    }

    const last = turn.rolls.at(-1);
    let hint = "";
    if (view.byLimit) hint = t("Pig.outOfTurns");
    else if (!last) {
      if (ctx.canAct) hint = t(next === 1 ? "Pig.yourRoll" : "Pig.yourRollMany");
      else if (prev?.type === "held") hint = t("Pig.held", { name: esc(ctx.name(prev.seat)), points: prev.points, total: prev.total });
    } else if (ctx.canAct) hint = t("Pig.more", { value: sum(last), points: turn.points });
    else if (ctx.playing) hint = t("Pig.rolled", { value: sum(last) });

    const buttons = [];
    if (ctx.canAct) {
      buttons.push({
        op: "hold",
        icon: "fa-feather-pointed",
        label: t("Pig.hold"),
        sub: turn.points || null,
        disabled: !last,
        tip: t(last ? "Pig.holdTip" : "Pig.holdFirst"),
      });
      buttons.push(rollButton(next, Boolean(last)));
    }

    return {
      die: last ? feltHtml(last, { scatter, rolling: rolled }) : "",
      many: (last?.length ?? next) > 1,
      // одним куском: число в <b> не отрывается от фразы
      hint: hint && `<span>${hint}</span>`,
      rolls: trayHtml(turn.rolls, false),
      points: turn.points,
      buttons,
    };
  },

  onAction(ctx, op) {
    if (op === "roll") ctx.send({ type: "roll" });
    else if (op === "hold") ctx.send({ type: "hold" });
  },

  logLine(ctx, ev, name) {
    switch (ev.type) {
      case "rolled":
        return false;
      case "bust": {
        const dice = inlineDice(ev.rolls.at(-1));
        if (ev.wiped) return t("Log.pig.wipe", { name, dice, lost: ev.wiped + ev.lost });
        return t(ev.lost ? "Log.pig.bust" : "Log.pig.bustZero", { name, dice, lost: ev.lost });
      }
      case "held":
        return t("Log.pig.held", { name, points: ev.points, total: ev.total });
      case "won":
        return t(ev.byLimit ? "Log.pig.wonLimit" : "Log.pig.won", { name, total: ev.total });
      default:
        return null;
    }
  },
};
