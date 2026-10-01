/* Связь игрок → ведущий и ведущий → владелец места.
   Запросы User#query сервер доставляет адресату; по общему сокету секреты не ходят. */

import { QUERY } from "./constants.mjs";
import { Host } from "./host.mjs";
import { has, t } from "./i18n.mjs";
import { Privates } from "./store.mjs";

const ACTION_TIMEOUT = 45000;

export function registerQueries() {
  CONFIG.queries[QUERY.action] = (data) => Host.request(data);
  CONFIG.queries[QUERY.private] = (data) => {
    Privates.receive(data);
    return true;
  };
  CONFIG.queries[QUERY.sync] = (data) => Host.sync(data?.userId);
}

export function explain(error) {
  return has(`Error.${error}`) ? t(`Error.${error}`) : t("Error.internal");
}

/** Отправить ход активному ведущему. Возвращает { ok, error? }. */
export async function sendAction(tableId, seatId, action) {
  const payload = { tableId, seatId, action, userId: game.user.id };
  const gm = game.users.activeGM;
  let res;
  if (!gm) res = { ok: false, error: "noGM" };
  else if (gm.isSelf) res = await Host.request(payload);
  else {
    try {
      res = await gm.query(QUERY.action, payload, { timeout: ACTION_TIMEOUT });
    } catch {
      res = { ok: false, error: "timeout" };
    }
  }
  if (!res?.ok) ui.notifications.warn(explain(res?.error));
  return res ?? { ok: false, error: "internal" };
}

/** Попросить ведущего дослать скрытое этого клиента (после входа в мир). */
export function requestSync() {
  const gm = game.users.activeGM;
  if (gm && !gm.isSelf) gm.query(QUERY.sync, { userId: game.user.id }).catch(() => {});
}

/** Показать результат действия ведущего (ошибку — уведомлением). */
export function report(res) {
  if (res && !res.ok) ui.notifications.warn(explain(res.error));
  return res;
}
