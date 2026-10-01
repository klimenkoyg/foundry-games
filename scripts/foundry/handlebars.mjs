/* Помощники шаблонов: кость к6 с точками, многогранники к4–к20, переводы. */

import { mulberry32 } from "../core/util.mjs";
import { tpl } from "./constants.mjs";
import { esc, money, t } from "./i18n.mjs";

const cls = (...list) => list.flat().filter(Boolean).join(" ");

/** Разброс «как упали»: поворот и сдвиг, одинаковые для одного и того же seed. */
function scatterStyle(seed) {
  const r = mulberry32(Math.imul(Number(seed) + 1, 2654435761));
  return `--rot:${(r() * 26 - 13).toFixed(1)}deg;--dx:${(r() * 10 - 5).toFixed(1)}px;--dy:${(r() * 14 - 7).toFixed(1)}px`;
}

function commonAttrs(o) {
  const attrs = [];
  if (o.button) attrs.push('type="button"');
  if (o.op) attrs.push(`data-action="game" data-op="${esc(o.op)}"`);
  if (o.arg !== undefined && o.arg !== null) attrs.push(`data-arg="${esc(o.arg)}"`);
  if (o.disabled) attrs.push("disabled");
  if (o.pressed !== undefined) attrs.push(`aria-pressed="${Boolean(o.pressed)}"`);
  if (o.tip) attrs.push(`data-tooltip="${esc(o.tip)}"`);
  return attrs;
}

/**
 * Кость к6. o: { cls, button, op, arg, disabled, pressed, label, tip, scatter }
 * button — рисуется кнопкой; op/arg — действие игры; scatter — зерно разброса.
 */
export function dieHtml(face, o = {}) {
  const tag = o.button ? "button" : "span";
  const attrs = [`class="${cls("tg-die", o.cls)}"`, `data-face="${Number(face) || 0}"`, ...commonAttrs(o)];
  attrs.push(`aria-label="${esc(o.label ?? face)}"`);
  if (o.scatter !== undefined && o.scatter !== null) attrs.push(`style="${scatterStyle(o.scatter)}"`);
  return `<${tag} ${attrs.join(" ")}>${"<i></i>".repeat(6)}</${tag}>`;
}

export const diceHtml = (values, o = {}) => values.map((v) => dieHtml(v, o)).join("");

const POLY = {
  4: { face: "28,4 54,50 2,50", facets: ["28,4 28,36", "2,50 28,36", "54,50 28,36"], ny: "5px" },
  6: { rect: true },
  8: { face: "28,2 54,28 28,54 2,28", facets: ["2,28 54,28"] },
  10: { face: "28,2 53,23 28,54 3,23", facets: ["3,23 28,33 53,23", "28,33 28,54"], ny: "-2px" },
  12: {
    face: "28,3 53,21 44,51 12,51 3,21",
    facets: ["28,13 42,23 37,40 19,40 14,23 28,13", "28,3 28,13", "53,21 42,23", "44,51 37,40", "12,51 19,40", "3,21 14,23"],
  },
  20: {
    face: "28,2 52,15 52,41 28,54 4,41 4,15",
    facets: ["28,13 46,40 10,40 28,13", "28,2 28,13", "52,15 28,13", "52,15 46,40", "52,41 46,40", "28,54 46,40", "28,54 10,40", "4,41 10,40", "4,15 10,40", "4,15 28,13"],
    ny: "4px",
    scale: 0.86,
  },
};

/** Многогранник. o: { value, cap, sm, cls, button, op, arg, disabled } */
export function polyHtml(sides, o = {}) {
  const d = POLY[sides] ?? POLY[6];
  const tag = o.button ? "button" : "span";
  const face = d.rect ? '<rect class="face" x="5" y="5" width="46" height="46" rx="9"/>' : `<polygon class="face" points="${d.face}"/>`;
  const facets = (d.facets ?? []).map((p) => `<polyline class="facet" points="${p}"/>`).join("");
  const numStyle = `translate:0 ${d.ny ?? "0"};${d.scale ? `scale:${d.scale}` : ""}`;
  const attrs = [`class="${cls("tg-poly", o.sm && "tg-poly--sm", o.cls)}"`, `data-sides="${sides}"`, ...commonAttrs(o)];
  const kind = t("Die.kind", { n: sides });
  attrs.push(`aria-label="${esc(o.value !== undefined && o.value !== "" ? `${kind}: ${o.value}` : kind)}"`);
  return (
    `<${tag} ${attrs.join(" ")}><svg viewBox="0 0 56 56" aria-hidden="true">${face}${facets}</svg>` +
    `<span class="tg-poly__num" style="${numStyle}">${esc(o.value ?? "")}</span>` +
    (o.cap ? `<span class="tg-poly__cap">${esc(kind)}</span>` : "") +
    `</${tag}>`
  );
}

export function registerHandlebars() {
  const safe = (html) => new Handlebars.SafeString(html);
  Handlebars.registerHelper("tgDie", (face, options) => safe(dieHtml(face, options.hash)));
  Handlebars.registerHelper("tgPoly", (sides, options) => safe(polyHtml(sides, options.hash)));
  Handlebars.registerHelper("tgT", (key, options) => t(key, options.hash));
  Handlebars.registerHelper("tgMoney", (amount, coin) => money(amount, coin));
}

export function preloadTemplates() {
  return foundry.applications.handlebars.loadTemplates({
    "tavern-games.seat": tpl("partials/seat.hbs"),
    "tavern-games.actionbar": tpl("partials/actionbar.hbs"),
  });
}
