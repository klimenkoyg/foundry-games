/* Бот «Костей лжеца».
   Видит только свой стаканчик и число чужих костей. Считает, насколько вероятна
   ставка на столе: маловероятную вскрывает («Не верю!»), очень точную — иногда «В точку!».
   Иначе повышает самой правдоподобной ставкой; по нраву блефует гранью, которой у него мало,
   и задирает количество. Открывает круг своей самой частой гранью. */

import { allowedFaces, bidProbability, countMatches, isHigherBid } from "../games/liars.mjs";
import { clamp, pick } from "../util.mjs";

const DOUBT = 0.35; // ниже — «Не верю!»
const EXACT = 0.35; // выше — можно «В точку!»
const PLAUSIBLE = 0.25; // блеф не слабее этого

export default function decide({ view, mine, seatId, temperament, rng }) {
  if (view.phase === "reveal") return { type: "next" };

  const cup = mine?.cup ?? [];
  const { onesWild } = view.rules;
  const total = view.totalDice;
  const unknown = Math.max(0, total - cup.length);
  const bid = view.bid;
  const faces = allowedFaces(view.rules);
  const own = (f) => countMatches({ own: cup }, f, onesWild);
  const prob = (q, f) => bidProbability(q, f, cup, unknown, onesWild);
  const canCall = Boolean(bid) && bid.seat !== seatId;
  const toBid = ({ q, f }) => ({ type: "bid", q, f });

  // Кандидаты: наименьшее повышение по каждой грани и на кость больше.
  const raises = [];
  for (const f of faces) {
    const min = !bid ? 1 : f > bid.f ? bid.q : bid.q + 1;
    for (const q of [min, min + 1]) {
      if (q >= 1 && q <= total && isHigherBid(bid, q, f)) raises.push({ q, f, p: prob(q, f), own: own(f) });
    }
  }
  if (!raises.length) return { type: "challenge" };

  // Ошибка по нраву: любой ход наугад.
  if (rng() > temperament.skill) {
    const pool = raises.map(toBid);
    if (canCall) pool.push({ type: "challenge" });
    return pick(rng, pool);
  }

  // Открытие круга: самая частая своя грань, количество — около ожидаемого.
  if (!bid) {
    const f = faces.reduce((a, b) => (own(b) >= own(a) ? b : a));
    const expected = own(f) + unknown * (onesWild && f !== 1 ? 1 / 3 : 1 / 6);
    return toBid({ q: clamp(Math.floor(expected + temperament.greed - 1), 1, total), f });
  }

  const pTrue = prob(bid.q, bid.f);
  const pExact = pTrue - prob(bid.q + 1, bid.f);
  // Лихой верит дольше, осторожный вскрывает раньше.
  const doubt = clamp(DOUBT - (temperament.greed - 1) * 0.15, 0.15, 0.5);
  if (canCall && pTrue < doubt) return { type: "challenge" };
  if (canCall && view.rules.spotOn && pExact > EXACT && rng() < 0.5) return { type: "spotOn" };

  let choice = raises.reduce((a, b) => (b.p > a.p ? b : a));
  // Правдоподобно повысить нечем — вернее вскрыть.
  if (canCall && choice.p < doubt && 1 - pTrue > choice.p) return { type: "challenge" };

  if (rng() < temperament.bluff) {
    const plausible = raises.filter((r) => r.p >= PLAUSIBLE);
    if (plausible.length) {
      const least = Math.min(...plausible.map((r) => r.own));
      choice = pick(rng, plausible.filter((r) => r.own === least));
    }
  }
  let q = choice.q;
  if (temperament.greed > 1 && q < total && rng() < (temperament.greed - 1) * 0.3) q += 1;
  return toBid({ q, f: choice.f });
}
