/* «Кнаклбоунс» — два поля три на три. Наведение на колонку показывает, куда ляжет кость
   и какие кости соперника она собьёт. */

import { columnScore } from "../../core/games/kb.mjs";
import { tpl } from "../constants.mjs";
import { dieHtml } from "../handlebars.mjs";
import { esc, t } from "../i18n.mjs";
import { cls, inlineDice, isFresh } from "./common.mjs";

const ORDINAL = ["first", "second", "third"];

function countOf(col) {
  const c = {};
  for (const v of col) c[v] = (c[v] ?? 0) + 1;
  return c;
}

export default {
  id: "kb",
  icon: "fa-solid fa-bone",
  template: tpl("games/kb.hbs"),
  rollEvents: ["rolledDie"],
  noRail: true,

  subtitle: () => t("Kb.sub"),

  board(ctx) {
    const { view } = ctx;
    const [a, b] = view.order;
    // Своё поле — снизу; у зрителя и ведущего снизу первое место.
    const bottomId = ctx.mySeat?.id ?? (ctx.acting && view.order.includes(ctx.acting.id) ? ctx.acting.id : a);
    const topId = bottomId === a ? b : a;
    const placed = ctx.animate ? ctx.fresh.filter((e) => e.type === "placed").at(-1) : null;

    const side = (seatId, isTop) => {
      const seat = ctx.seat(seatId);
      const board = view.boards[seatId] ?? [[], [], []];
      const interactive = ctx.canAct && ctx.acting.id === seatId && view.current === seatId;
      const cols = board.map((col, ci) => {
        const counts = countOf(col);
        const wells = [0, 1, 2].map((r) => {
          const v = col[r];
          if (v === undefined) {
            // Только что сбитые кости улетают из своих лунок.
            const knocked = placed && placed.seat !== seatId && placed.col === ci && r < col.length + placed.knocked;
            return knocked ? dieHtml(placed.value, { cls: "is-knocked" }) : "";
          }
          const landed = placed && placed.seat === seatId && placed.col === ci && r === col.length - 1;
          return dieHtml(v, { cls: cls(counts[v] === 2 && "m2", counts[v] >= 3 && "m3", landed && "is-landed") });
        });
        const mult = Math.max(1, ...Object.values(counts));
        return { index: ci, wells, score: columnScore(col), mult: mult > 1 ? mult : null, x3: mult >= 3, full: col.length >= 3, interactive };
      });
      return {
        id: seatId,
        name: seat?.name ?? "?",
        img: seat?.img,
        isTop,
        cols,
        total: view.totals[seatId] ?? 0,
        isTurn: view.current === seatId,
        thinking: view.current === seatId && seat?.control === "bot",
        interactive,
      };
    };

    let divider;
    if (view.finished) {
      const ta = view.totals[a];
      const tb = view.totals[b];
      divider = view.winner
        ? t("Kb.wins", { name: ctx.name(view.winner), a: Math.max(ta, tb), b: Math.min(ta, tb) })
        : t("Kb.draw", { a: ta, b: tb });
    } else if (ctx.canAct) divider = t("Kb.yourTurn");
    else divider = t("Status.turnOf", { name: ctx.name(view.current) });

    return {
      top: side(topId, true),
      bottom: side(bottomId, false),
      divider,
      die: view.die ? dieHtml(view.die, { cls: isFresh(ctx, "rolledDie") || isFresh(ctx, "start") ? "is-rolling" : "" }) : "",
      dieValue: view.die,
      plateLabel: view.die ? (ctx.canAct ? t("Kb.yourDie") : t("Kb.dieOf", { name: ctx.name(view.current) })) : "",
    };
  },

  /** Призрак кости в колонке и дрожь костей соперника, которые она собьёт. */
  afterRender(ctx, el) {
    const value = ctx.view.die;
    if (!ctx.canAct || !value) return;
    for (const col of el.querySelectorAll("button.tg-kb__col")) {
      const index = col.dataset.arg;
      const preview = (on) => {
        col.querySelector(".tg-die.is-ghost")?.remove();
        const rivals = el.querySelectorAll(`div.tg-kb__col[data-col="${index}"] .tg-die`);
        for (const d of rivals) d.classList.toggle("is-threat", on && Number(d.dataset.face) === value);
        if (!on || col.disabled) return;
        const well = [...col.querySelectorAll(".tg-well")].find((w) => !w.firstElementChild);
        well?.insertAdjacentHTML("beforeend", dieHtml(value, { cls: "is-ghost" }));
      };
      col.addEventListener("mouseenter", () => preview(true));
      col.addEventListener("focus", () => preview(true));
      col.addEventListener("mouseleave", () => preview(false));
      col.addEventListener("blur", () => preview(false));
    }
  },

  onAction(ctx, op, arg) {
    if (op === "place") ctx.send({ type: "place", col: Number(arg) });
  },

  logLine(ctx, ev, name) {
    switch (ev.type) {
      case "placed":
        return t(ev.knocked ? "Log.kb.placedKnock" : "Log.kb.placed", {
          name,
          die: inlineDice([ev.value]),
          col: t(`Kb.col.${ORDINAL[ev.col]}`),
          n: ev.knocked,
        });
      case "rolledDie":
        return false;
      case "won":
        return t("Log.kb.won", { name: `<b>${esc(ctx.name(ev.seat))}</b>` });
      case "draw":
        return t("Log.kb.draw");
      default:
        return null;
    }
  },
};
