/* Памятка правил: текст из переводов и условия стола.
   Открыта от стола — условия этого стола; из «Таверны» — те, что мы советуем (задаёт их ведущий). */

import { SETTINGS, tpl } from "../constants.mjs";
import { t } from "../i18n.mjs";
import { getGame } from "../registry.mjs";
import { setting } from "../settings.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class RulesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options) {
    super(options);
    this.gameId = options.gameId;
    this.table = options.table ?? null;
  }

  static DEFAULT_OPTIONS = {
    classes: ["tavern-games", "tg-rules-app"],
    window: { icon: "fa-solid fa-book-open", resizable: true },
    position: { width: 480, height: "auto" },
  };

  static PARTS = { body: { template: tpl("rules.hbs") } };

  get title() {
    return t("Rules.title", { game: t(`Game.${this.gameId}.name`) });
  }

  get theme() {
    const override = setting(SETTINGS.themeOverride);
    return override !== "table" ? override : (this.table?.theme ?? setting(SETTINGS.defaultTheme));
  }

  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    frame.dataset.tgTheme = this.theme;
    return frame;
  }

  async _prepareContext() {
    const entry = getGame(this.gameId);
    const options = this.table?.options ?? entry.rules.normalizeOptions({});
    const scope = { preset: !this.table, table: this.table };
    const data = entry.ui.rulesData?.(options, scope) ?? options;
    return {
      html: t(`Rules.${this.gameId}`, data),
      terms: entry.ui.rulesTerms?.(options, scope) ?? [],
      termsTitle: t(scope.preset ? "Rules.termsPreset" : "Rules.termsTable"),
      termsNote: scope.preset ? t("Rules.termsNote") : "",
    };
  }
}

export function openRules(gameId, table = null) {
  const id = `tavern-rules-${gameId}`;
  const open = foundry.applications.instances.get(id);
  if (open) {
    open.bringToFront();
    return open;
  }
  const app = new RulesApp({ id, gameId, table });
  app.render({ force: true });
  return app;
}
