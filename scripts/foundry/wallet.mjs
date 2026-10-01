/* Ставки. В любой системе — «фишки» (ничего не списывается, считает ведущий).
   В dnd5e — монеты с листов: списать ставку, выдать банк, вернуть при снятии стола. */

import { COINS, canAfford, deduct, normalizePurse } from "../core/purse.mjs";

export const isDnd5e = () => game.system.id === "dnd5e";

export const coinChoices = () => (isDnd5e() ? COINS : ["chips"]);

export const defaultCoin = () => (isDnd5e() ? "gp" : "chips");

function purseOf(actor) {
  const currency = actor?.system?.currency;
  return currency ? normalizePurse(currency) : null;
}

/** Сколько у актёра монет этого вида (для подписи у места). */
export function coinsOf(actor, coin) {
  return purseOf(actor)?.[coin] ?? null;
}

export function canPay(actor, amount, coin) {
  const purse = purseOf(actor);
  return Boolean(purse) && coin in purse && canAfford(purse, amount, coin);
}

/** Снять с листа; false — листа нет или не хватает. */
export async function charge(actor, amount, coin) {
  const purse = purseOf(actor);
  if (!purse || !(coin in purse) || amount <= 0) return false;
  const next = deduct(purse, amount, coin);
  if (!next) return false;
  await actor.update({ "system.currency": next });
  return true;
}

/** Положить на лист; false — листа с монетами нет. */
export async function pay(actor, amount, coin) {
  const purse = purseOf(actor);
  if (!purse || !(coin in purse) || amount <= 0) return false;
  await actor.update({ [`system.currency.${coin}`]: purse[coin] + amount });
  return true;
}
