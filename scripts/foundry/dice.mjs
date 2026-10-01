/* Броски: настоящий Roll, Dice So Nice, режим «броски в чате».
   Скрытые броски (стаканчики) никому не показываются — их кости увидит только владелец в окне. */

import { MODULE_ID, SETTINGS } from "./constants.mjs";
import { setting } from "./settings.mjs";

const DSN_TIMEOUT = 6000;

/** С таймаутом: если Dice So Nice завис, партия не встаёт. */
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

async function show(roll, { user, flavor, alias }) {
  const mode = setting(SETTINGS.chatRolls);
  if (mode === "silent") {
    if (game.dice3d) await withTimeout(game.dice3d.showForRoll(roll, user ?? game.user, true), DSN_TIMEOUT);
    return;
  }
  // v14: видимость сообщения — messageMode; раньше — rollMode.
  const options = CONFIG.ChatMessage?.modes
    ? { messageMode: mode === "gm" ? "gm" : "public" }
    : { rollMode: mode === "gm" ? "gmroll" : "publicroll" };
  const message = roll.toMessage({ flavor, speaker: { alias } }, options);
  if (game.dice3d) {
    const created = await message;
    await withTimeout(game.dice3d.waitFor3DAnimationByMessageID?.(created?.id) ?? Promise.resolve(), DSN_TIMEOUT);
  } else {
    await message;
  }
}

/**
 * dice: [{ sides, count }] → number[][] (по массиву на запись).
 * opts: { secret, user, flavor, alias }
 */
export async function rollDice(dice, opts = {}) {
  const formula = dice.map((d) => `${d.count}d${d.sides}`).join(" + ");
  const roll = await new Roll(formula).evaluate();
  const values = roll.dice.map((term) => term.results.map((r) => r.result));
  if (!opts.secret) {
    try {
      await show(roll, opts);
    } catch (err) {
      console.warn(`${MODULE_ID} | не удалось показать бросок`, err);
    }
  }
  return values;
}
