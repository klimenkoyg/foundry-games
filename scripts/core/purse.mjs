/* Кошелёк dnd5e в чистом виде: сколько монет, хватает ли, как снять сумму с разменом.
   Всё считается в медных, чтобы не было дробей. */

export const COINS = ["pp", "gp", "ep", "sp", "cp"];

export const COPPER = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };

export function normalizePurse(currency) {
  return Object.fromEntries(COINS.map((k) => [k, Math.max(0, Math.floor(Number(currency?.[k]) || 0))]));
}

export const totalCopper = (purse) => COINS.reduce((s, k) => s + purse[k] * COPPER[k], 0);

export const canAfford = (purse, amount, coin) => totalCopper(purse) >= amount * COPPER[coin];

/** Сдача: сначала той же монетой, потом покрупнее к помельче; электрум — в последнюю очередь. */
function giveChange(purse, change, coin) {
  const order = [coin, ...COINS.filter((c) => c !== coin && c !== "ep"), "ep"];
  for (const c of order) {
    const n = Math.floor(change / COPPER[c]);
    purse[c] += n;
    change -= n * COPPER[c];
  }
}

/**
 * Снять `amount` монет `coin`. Сначала берём саму монету, потом мелочь,
 * потом размениваем самую мелкую из оставшихся. Возвращает новый кошелёк
 * или null, если денег не хватает. Вход не меняется.
 */
export function deduct(purseIn, amount, coin) {
  let need = amount * COPPER[coin];
  if (need <= 0) return { ...purseIn };
  if (totalCopper(purseIn) < need) return null;
  const purse = { ...purseIn };

  const own = Math.min(purse[coin], Math.floor(need / COPPER[coin]));
  purse[coin] -= own;
  need -= own * COPPER[coin];

  for (const k of COINS) {
    if (COPPER[k] >= COPPER[coin]) continue;
    const n = Math.min(purse[k], Math.floor(need / COPPER[k]));
    purse[k] -= n;
    need -= n * COPPER[k];
  }

  const ascending = [...COINS].reverse();
  while (need > 0) {
    const k = ascending.find((c) => purse[c] > 0);
    if (!k) return null;
    purse[k] -= 1;
    if (COPPER[k] >= need) {
      giveChange(purse, COPPER[k] - need, coin);
      need = 0;
    } else {
      need -= COPPER[k];
    }
  }
  return purse;
}
