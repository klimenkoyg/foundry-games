import { MODULE_ID, SETTINGS } from "./constants.mjs";

export const setting = (key) => game.settings.get(MODULE_ID, key);

export const setSetting = (key, value) => game.settings.set(MODULE_ID, key, value);

export function registerSettings({ onTables, onLook }) {
  const reg = (key, data) => game.settings.register(MODULE_ID, key, data);
  const name = (key) => ({ name: `TAVERN.Settings.${key}.name`, hint: `TAVERN.Settings.${key}.hint` });

  // Публичное состояние столов: пишет только активный ведущий, читают все.
  reg(SETTINGS.tables, { scope: "world", config: false, type: Object, default: {}, onChange: onTables });
  // Скрытое состояние (стаканчики «Костей лжеца») — только в браузере ведущего.
  reg(SETTINGS.secrets, { scope: "client", config: false, type: Object, default: {} });
  reg(SETTINGS.lastGame, { scope: "client", config: false, type: String, default: "farkle" });

  reg(SETTINGS.defaultTheme, {
    ...name("defaultTheme"),
    scope: "world",
    config: true,
    type: String,
    choices: { tavern: "TAVERN.Theme.tavern", parchment: "TAVERN.Theme.parchment" },
    default: "tavern",
  });
  reg(SETTINGS.themeOverride, {
    ...name("themeOverride"),
    scope: "client",
    config: true,
    type: String,
    choices: {
      table: "TAVERN.Settings.themeOverride.table",
      tavern: "TAVERN.Theme.tavern",
      parchment: "TAVERN.Theme.parchment",
    },
    default: "table",
    onChange: onLook,
  });
  reg(SETTINGS.chatRolls, {
    ...name("chatRolls"),
    scope: "world",
    config: true,
    type: String,
    choices: {
      silent: "TAVERN.Settings.chatRolls.silent",
      gm: "TAVERN.Settings.chatRolls.gm",
      public: "TAVERN.Settings.chatRolls.public",
    },
    default: "silent",
  });
  reg(SETTINGS.botDelay, {
    ...name("botDelay"),
    scope: "world",
    config: true,
    type: Number,
    range: { min: 300, max: 3000, step: 100 },
    default: 1100,
  });
  reg(SETTINGS.announce, { ...name("announce"), scope: "world", config: true, type: Boolean, default: true });
  reg(SETTINGS.animations, {
    ...name("animations"),
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: onLook,
  });
  reg(SETTINGS.sounds, { ...name("sounds"), scope: "client", config: true, type: Boolean, default: true });
}
