/* Переводы: ключи TAVERN.* в lang/ru.json и lang/en.json. */

const PREFIX = "TAVERN.";

const full = (key) => (key.startsWith(PREFIX) ? key : PREFIX + key);

export const has = (key) => game.i18n.has(full(key));

/** Перевод с подстановкой {имя}. Подстановку делаем сами — одинаково на любой версии Foundry. */
export function t(key, data) {
  const text = game.i18n.localize(full(key));
  if (!data) return text;
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in data ? String(data[name]) : m));
}

let rules = null;
let rulesLang = null;

/** Множественное число: ключи <key>.one / .few / .many / .other. */
export function plural(n, key, data = {}) {
  const lang = game.i18n.lang;
  if (rulesLang !== lang) {
    rules = new Intl.PluralRules(lang);
    rulesLang = lang;
  }
  const form = rules.select(Math.abs(n));
  const k = has(`${key}.${form}`) ? `${key}.${form}` : `${key}.other`;
  return t(k, { n, ...data });
}

/** «15 зм» или «15 фишек». */
export function money(amount, coin) {
  if (!coin || coin === "chips") return plural(amount, "Coin.chips");
  return `${amount} ${t(`Coin.${coin}`)}`;
}

export const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
