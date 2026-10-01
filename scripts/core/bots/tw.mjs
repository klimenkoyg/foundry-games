/* Бот «Двадцати одного».
   Считает шанс перебора для каждой невзятой кости. Пока за ним ещё кто-то ходит —
   берёт самую крупную кость, чей риск укладывается в терпимость по нраву; отстаёт
   от закрытой руки соперника — рискует сильнее. Ходит последним — знает, сколько
   нужно побить, и тянет самую безопасную кость, пока не обгонит. */

import { DICE, bustChance } from "../games/tw.mjs";
import { pick } from "../util.mjs";

const STAND = { type: "stand" };
const take = (sides) => ({ type: "take", sides });

export default function decide({ view, seatId, temperament, rng }) {
  const hand = view.hands[seatId];
  const { limit } = view.rules;
  const { total } = hand;
  const unused = DICE.filter((sides) => !hand.rolled.some((r) => r.sides === sides));
  if (!unused.length) return STAND;

  const p = (sides) => bustChance(total, sides, limit);
  // самая безопасная кость; при равном риске — крупнее
  const safest = unused.reduce((a, b) => (p(b) < p(a) || (p(b) === p(a) && b > a) ? b : a));

  // Ошибка наугад: любой допустимый ход, кроме заведомо пустых (верный перебор, стоп на нуле).
  if (rng() > temperament.skill) {
    const moves = unused.filter((sides) => p(sides) < 1).map(take);
    if (total > 0) moves.push(STAND);
    return moves.length ? pick(rng, moves) : STAND;
  }

  const others = view.order.filter((id) => id !== seatId);
  const closed = others.filter((id) => view.hands[id].done);
  const best = Math.max(0, ...closed.filter((id) => !view.hands[id].bust).map((id) => view.hands[id].total));

  // Последним ходит — знает, сколько нужно побить.
  if (closed.length === others.length) {
    if (total > best) return STAND;
    // при равенстве круг ничей — незачем дарить его перебором
    if (total === best && p(safest) > 0.5) return STAND;
    return take(safest);
  }

  const behind = total < best;
  let tolerance = 0.22 * temperament.greed;
  if (behind) tolerance *= 2;
  const candidates = unused.filter((sides) => p(sides) <= tolerance);
  if (candidates.length && total < limit) return take(Math.max(...candidates));
  // стоять ниже закрытой руки — верный проигрыш круга, надо догонять
  if (behind && p(safest) < 1) return take(safest);
  return STAND;
}
