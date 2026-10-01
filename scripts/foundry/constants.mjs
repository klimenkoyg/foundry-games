export const MODULE_ID = "ssl_tavern_games";

export const SETTINGS = {
  tables: "tables",
  secrets: "secrets",
  defaultTheme: "defaultTheme",
  themeOverride: "themeOverride",
  chatRolls: "chatRolls",
  botDelay: "botDelay",
  animations: "animations",
  sounds: "sounds",
  announce: "announce",
  lastGame: "lastGame",
};

export const THEMES = ["tavern", "parchment"];

export const QUERY = {
  action: `${MODULE_ID}.action`,
  private: `${MODULE_ID}.private`,
  sync: `${MODULE_ID}.sync`,
};

/** Сколько последних событий стола хранится для журнала. */
export const EVENT_LIMIT = 60;

export const tpl = (path) => `modules/${MODULE_ID}/templates/${path}`;
