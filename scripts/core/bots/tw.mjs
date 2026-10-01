/* Бот «Двадцати одного».
   Считает шанс перебора для каждой невзятой кости и берёт самую крупную, чей риск
   укладывается в терпимость по нраву; отстаёт от соперника — рискует сильнее.
   За ход берёт одну кость и передаёт ход: это ничего не стоит и показывает, что сделают
   соперники. Вторую подряд тянет, только когда догоняет. Пасует, когда брать уже
   страшно, а отставать не от кого. Остался последним с открытой рукой — знает,
   сколько нужно побить, и тянет самую безопасную кость, пока не обгонит. */

import { DICE, bustChance } from "../games/tw.mjs";
import { pick } from "../util.mjs";

const STAND = { type: "stand" };
const PASS = { type: "pass" };
const take = (sides) => ({ type: "take", sides });

export default function decide({ view, seatId, temperament, rng }) {
  const hand = view.hands[seatId];
  const { limit } = view.rules;
  const { total } = hand;
  const took = view.took ?? 0;
  const unused = DICE.filter((sides) => !hand.rolled.some((r) => r.sides === sides));

  const others = view.order.filter((id) => id !== seatId);
  const active = others.filter((id) => !view.hands[id].done);
  // Взял кость и есть кому передать — пасовать незачем: передать ход всегда не хуже.
  const rest = took > 0 && active.length ? PASS : STAND;
  if (!unused.length) return rest;

  const p = (sides) => bustChance(total, sides, limit);
  // самая безопасная кость; при равном риске — крупнее
  const safest = unused.reduce((a, b) => (p(b) < p(a) || (p(b) === p(a) && b > a) ? b : a));

  // Ошибка наугад: любой допустимый ход, кроме заведомо пустых (верный перебор, пас на нуле).
  if (rng() > temperament.skill) {
    const moves = unused.filter((sides) => p(sides) < 1).map(take);
    if (rest === PASS || total > 0) moves.push(rest);
    return moves.length ? pick(rng, moves) : rest;
  }

  // лучшая сумма соперников без перебора — закрытая или ещё нет
  const best = Math.max(0, ...others.filter((id) => !view.hands[id].bust).map((id) => view.hands[id].total));

  // Все соперники закрылись — знает, сколько нужно побить.
  if (!active.length) {
    if (total > best) return STAND;
    // при равенстве круг ничей — незачем дарить его перебором
    if (total === best && p(safest) > 0.5) return STAND;
    return take(safest);
  }

  const behind = total < best;
  // Одна кость за ход; вторую подряд — только догоняя.
  if (took > 0 && !behind) return PASS;

  let tolerance = 0.22 * temperament.greed;
  if (behind) tolerance *= 2;
  const candidates = unused.filter((sides) => p(sides) <= tolerance);
  if (candidates.length && total < limit) return take(Math.max(...candidates));
  if (took > 0) return PASS;
  // пас позади соперника — верный проигрыш круга, надо догонять
  if (behind && p(safest) < 1) return take(safest);
  return STAND;
}
