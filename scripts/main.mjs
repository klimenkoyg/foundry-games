/* Таверна · Tavern Games — настольные игры на костях для Foundry VTT v14. */

import { LobbyApp } from "./foundry/apps/lobby.mjs";
import { openRules } from "./foundry/apps/rules-app.mjs";
import { SeatingApp } from "./foundry/apps/seating-app.mjs";
import { MODULE_ID } from "./foundry/constants.mjs";
import { preloadTemplates, registerHandlebars } from "./foundry/handlebars.mjs";
import { Host } from "./foundry/host.mjs";
import { t } from "./foundry/i18n.mjs";
import { Manager } from "./foundry/manager.mjs";
import { listGames } from "./foundry/registry.mjs";
import { registerSettings } from "./foundry/settings.mjs";
import { Store } from "./foundry/store.mjs";
import { registerQueries } from "./foundry/transport.mjs";

/** Кнопка на панели: ведущему — лобби, игроку — вернуть окна столов. */
function openPanel() {
  if (game.user.isGM) return LobbyApp.open();
  if (!Manager.reopenAll()) ui.notifications.info(t("Notify.noTables"));
}

Hooks.once("init", () => {
  registerSettings({ onTables: () => Manager.refresh(), onLook: () => Manager.refresh() });
  registerHandlebars();
  registerQueries();
  preloadTemplates();
});

Hooks.once("ready", () => {
  Host.ensure();
  Manager.init();
  game.modules.get(MODULE_ID).api = {
    /** Панель ведущего. */
    openLobby: () => LobbyApp.open(),
    /** Окно посадки: openSeating("farkle"). */
    openSeating: (gameId) => (game.user.isGM ? SeatingApp.open(gameId) : ui.notifications.warn(t("Notify.gmOnly"))),
    openRules,
    /** Идентификаторы игр. */
    games: () => listGames().map((g) => g.id),
    /** Столы, которые сейчас на столе. */
    tables: () => Store.list(),
    /** Создать стол из макроса (только активный ведущий): см. Host.createTable. */
    createTable: (config) => Host.createTable(config),
    removeTable: (tableId, options) => Host.removeTable(tableId, options),
  };
});

// Ведущий вошёл или вышел — возможно, хост столов теперь этот клиент; игроку досылаем его скрытое.
Hooks.on("userConnected", (user, connected) => {
  Host.ensure();
  if (connected && Host.active) Host.sync(user.id);
});

Hooks.on("getSceneControlButtons", (controls) => {
  const tool = {
    name: "tavernGames",
    title: "TAVERN.Controls.title",
    icon: "fa-solid fa-beer-mug-empty",
    button: true,
    visible: true,
  };
  if (Array.isArray(controls)) {
    controls.find((c) => c.name === "token")?.tools.push({ ...tool, onClick: openPanel });
    return;
  }
  const tokens = controls.tokens;
  if (!tokens?.tools) return;
  tokens.tools.tavernGames = { ...tool, order: Object.keys(tokens.tools).length, onChange: openPanel };
});

// «За стол» в меню токена — сажает токен в окно посадки.
Hooks.on("renderTokenHUD", (hud, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const column = root?.querySelector(".col.right");
  if (!column || column.querySelector("[data-tavern-seat]")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon";
  button.dataset.tavernSeat = "";
  button.dataset.tooltip = t("Hud.seat");
  button.setAttribute("aria-label", t("Hud.seat"));
  button.innerHTML = '<i class="fa-solid fa-chair" inert></i>';
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const tokenDoc = hud.document ?? hud.object?.document;
    if (tokenDoc) SeatingApp.addToken(tokenDoc);
  });
  column.appendChild(button);
});
