/* «Покер на костях» — поле и действия. Кости для переброса выбираются в окне. */

import { HAND_RANKS, evaluateHand } from "../../core/games/poker.mjs";
import { tpl } from "../constants.mjs";
import { dieHtml } from "../handlebars.mjs";
import { esc, plural, t } from "../i18n.mjs";
import { cls, inlineDice } from "./common.mjs";

const handName = (values) => t(`Poker.hand.${evaluateHand(values).name}`);

function selection(ctx) {
  const { view, ui } = ctx;
  const key = `${view.handNo}:${view.phase}:${view.current}`;
  if (ui.key !== key) {
    ui.key = key;
    ui.sel = [];
  }
  return ui.sel;
}

export default {
  id: "poker",
  icon: "fa-solid fa-crown",
  template: tpl("games/poker.hbs"),
  rollEvents: ["dealt", "rerolled"],

  rulesData: (o) => ({ hands: o.handsToWin, raise: o.raise, maxRaises: o.maxRaises }),

  /** Размер повышения — ставка стола; без ставки круги ставок не играются. */
  hiddenOptions: ["raise"],
  prepareOptions: (options, stake) => ({
    ...options,
    raise: Math.max(1, stake.amount || 1),
    betting: Boolean(options.betting) && stake.amount > 0,
  }),

  subtitle(ctx) {
    const { view } = ctx;
    return t("Poker.sub", { hand: view.handNo, wins: plural(view.rules.handsToWin, "Poker.winsCount") });
  },

  seatInfo(ctx, seat) {
    const { view } = ctx;
    const dice = view.dice?.[seat.id];
    if (!dice) return {};
    const folded = view.folded[seat.id];
    const chips = folded
      ? [{ icon: "fa-flag", text: t("Poker.folded"), cls: "tg-chip--danger" }]
      : [{ text: handName(dice), cls: "tg-chip--accent" }];
    return {
      pips: Array.from({ length: view.rules.handsToWin }, (_, i) => i < (view.handWins[seat.id] ?? 0)),
      chips,
      out: folded,
      extra: seat.id === ctx.me?.id ? null : `<span class="tg-poker__opp-hand">${inlineDice(dice)}</span>`,
    };
  },

  board(ctx) {
    const { view, table } = ctx;
    const mainId = ctx.me?.id ?? view.current ?? view.order[0];
    const dice = view.dice[mainId] ?? [];
    const myTurn = ctx.canAct && ctx.acting.id === mainId;
    const betting = view.phase === "bet1" || view.phase === "bet2";
    const picking = myTurn && view.phase === "reroll";
    const sel = picking ? selection(ctx) : [];
    const rolledNow = ctx.animate
      ? ctx.fresh.filter((e) => (e.type === "rerolled" && e.seat === mainId) || e.type === "dealt").at(-1)
      : null;
    const rerolledIdx = rolledNow?.type === "rerolled" ? rolledNow.indices : rolledNow ? [0, 1, 2, 3, 4] : [];

    const rank = dice.length ? evaluateHand(dice) : null;
    const coin = (n) => ctx.money(n);
    const put = view.round.put[mainId] ?? 0;
    const toCall = view.round.highest - put;

    let text;
    const buttons = [];
    if (ctx.finished) text = "";
    else if (myTurn && betting) {
      text = toCall > 0 ? t("Poker.toCall", { amount: coin(toCall) }) : t("Poker.checkOrBet");
      buttons.push({ op: "fold", icon: "fa-flag", cls: "tg-btn--danger", label: t("Poker.fold") });
      buttons.push({
        op: "bet",
        icon: "fa-arrow-up",
        label: t("Poker.raise", { amount: coin(view.rules.raise) }),
        disabled: view.round.raises >= view.rules.maxRaises,
        tip: view.round.raises >= view.rules.maxRaises ? t("Poker.noRaises") : null,
      });
      buttons.push(
        toCall > 0
          ? { op: "call", icon: "fa-coins", cls: "tg-btn--primary", label: t("Poker.call", { amount: coin(toCall) }) }
          : { op: "check", icon: "fa-hand", cls: "tg-btn--primary", label: t("Poker.check") },
      );
    } else if (picking) {
      text = t("Poker.pickReroll");
      buttons.push({ op: "keep", label: t("Poker.keep") });
      buttons.push({ op: "reroll", icon: "fa-rotate-right", cls: "tg-btn--primary", label: plural(sel.length, "Poker.reroll"), disabled: !sel.length });
    } else if (ctx.current) {
      text = t(`Poker.wait.${view.phase}`, { name: esc(ctx.current.name) });
    }

    const last = view.lastHand;
    let lastText = null;
    if (last && last.handNo === view.handNo - 1 && view.phase !== "bet2") {
      lastText = last.winner
        ? t(last.byFold ? "Poker.lastFold" : "Poker.lastHand", {
            name: esc(ctx.name(last.winner)),
            hand: last.hands[last.winner] ? t(`Poker.hand.${last.hands[last.winner].name}`) : "",
          })
        : t("Poker.lastDraw");
    }

    return {
      handLabel: ctx.mySeat?.id === mainId ? t("Poker.yourHand") : t("Poker.handOf", { name: ctx.name(mainId) }),
      dice: dice
        .map((v, i) =>
          dieHtml(v, {
            button: picking,
            op: "toggle",
            arg: i,
            scatter: view.handNo * 53 + i * 7 + table.seats.length,
            cls: cls("tg-die--lg", sel.includes(i) && "is-reroll", rerolledIdx.includes(i) && "is-rolling"),
          }),
        )
        .join(""),
      handName: rank ? t(`Poker.hand.${rank.name}`) : "",
      folded: Boolean(view.folded[mainId]),
      ladder: HAND_RANKS.map((name, i) => ({ name: t(`Poker.hand.${name}`), on: rank?.rank === i })),
      text,
      lastText,
      buttons,
    };
  },

  onAction(ctx, op, arg) {
    if (op === "toggle") {
      const sel = selection(ctx);
      const i = Number(arg);
      const at = sel.indexOf(i);
      if (at >= 0) sel.splice(at, 1);
      else sel.push(i);
      ctx.rerender();
    } else if (op === "reroll") ctx.send({ type: "reroll", indices: [...selection(ctx)] });
    else if (op === "keep") ctx.send({ type: "reroll", indices: [] });
    else if (["check", "bet", "call", "fold"].includes(op)) ctx.send({ type: op });
  },

  logLine(ctx, ev, name) {
    const coin = (n) => ctx.money(n);
    switch (ev.type) {
      case "dealt":
        return t("Log.poker.dealt", { n: ev.handNo });
      case "checked":
        return t("Log.poker.checked", { name });
      case "bet":
        return t("Log.poker.bet", { name, amount: coin(ev.highest) });
      case "called":
        return t("Log.poker.called", { name, amount: coin(ev.highest) });
      case "folded":
        return t("Log.poker.folded", { name });
      case "rerolled":
        return ev.indices.length
          ? t("Log.poker.rerolled", { name, n: plural(ev.indices.length, "Dice"), hand: handName(ev.values) })
          : t("Log.poker.kept", { name, hand: handName(ev.values) });
      case "showdown":
        return false;
      case "handWon": {
        const hand = ctx.view.lastHand?.handNo === ev.handNo ? ctx.view.lastHand.hands[ev.seat] : null;
        return t("Log.poker.handWon", { name, hand: hand ? ` — ${t(`Poker.hand.${hand.name}`)}` : "" });
      }
      case "handDraw":
        return t("Log.poker.handDraw");
      case "won":
        return t("Log.poker.won", { name });
      default:
        return null;
    }
  },
};
