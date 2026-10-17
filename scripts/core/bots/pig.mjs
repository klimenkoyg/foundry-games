/* Бот «Свиньи».
   Порог хода: с какого счёта хода следующий бросок уже в среднем не окупается — то, что он
   принесёт, меньше того, что сгорит. Для одного кубика это 20 (классика «держать до 20»),
   для нескольких — меньше: единица выпадает чаще. Если две единицы сжигают весь счёт, порог
   тем ниже, чем больше записано. К порогу — поправка «держать темп» (Neller, Presser): за каждые
   8 очков отставания от лидера (в игре до 100) — очко сверху. Если соперник в полутора ходах
   от цели, бот бросает до победы; так же и сам у цели — если две единицы не грозят всему счёту.
   Нрав двигает порог: осторожный записывает раньше, безрассудный тянет; неумелый порой
   останавливается не там. Последний ход перед пределом ходов отстающий тянет, пока не обгонит лидера. */

import { diceFor } from "../games/pig.mjs";

const FACE = 4;        // средняя грань без единицы: (2+3+4+5+6)/5
const CATCH_UP = 8;
const RACE = 1.4;      // «у цели» — ближе, чем полтора обычных хода (один кубик: 29 очков)

const ROLL = { type: "roll" };
const HOLD = { type: "hold" };

/** Счёт хода, при котором бросок n кубиков в среднем ничего не даёт.
    Считается в исходах броска (6ⁿ), без дробей: для одного кубика выходит ровно 20. */
export function breakEven(n, score, snakeEyes) {
  const safe = 5 ** n;                      // ни одной единицы
  const lose = 6 ** n - safe;               // хоть одна
  // две единицы и больше: всё, кроме «ни одной» и «ровно одной»
  const wipe = snakeEyes ? lose - n * 5 ** (n - 1) : 0;
  return (safe * FACE * n - wipe * score) / lose;
}

/** Чуть дольше голого расчёта — так играют сильнее (один кубик: 21 вместо 20). */
const pace = (x) => (x * 21) / 20;

/* ---------- сколько длится партия ----------
   Считается без прогона партий: как ходит разумный бот (порог без поправок на соперников),
   какие у хода исходы с каждого счёта и через сколько кругов кто-нибудь доберётся до цели. */

/** Бросок n кубиков: вероятности «без единиц, сумма j», «ровно одна единица», «две и больше». */
function rollOdds(n) {
  let sums = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(sums.length + 6).fill(0);
    sums.forEach((p, s) => {
      if (p) for (let f = 2; f <= 6; f++) next[s + f] += p / 6;
    });
    sums = next;
  }
  const safe = (5 / 6) ** n;
  const one = (n / 6) * (5 / 6) ** (n - 1);
  return { sums, one, many: 1 - safe - one };
}

const addTo = (map, key, p) => map.set(key, (map.get(key) ?? 0) + p);

/** Исходы хода со счёта score: { gain: Map(записано → вероятность), bust, wipe }. Набор цели записан как need. */
function turnOutcome(rules, score, odds) {
  const need = rules.target - score;
  const gain = new Map();
  let bust = 0;
  let wipe = 0;
  let layer = new Map([[0, 1]]); // очки хода → вероятность после k бросков
  for (let k = 0; layer.size; k++) {
    const n = diceFor(rules, k);
    const { sums, one, many } = odds[n];
    const goal = pace(breakEven(n, score, rules.snakeEyes));
    const next = new Map();
    for (const [points, p] of layer) {
      if (k > 0 && points >= goal) {
        addTo(gain, points, p);
        continue;
      }
      bust += p * one;
      if (rules.snakeEyes) wipe += p * many;
      else bust += p * many;
      sums.forEach((q, j) => {
        if (!q) return;
        if (points + j >= need) addTo(gain, need, p * q);
        else addTo(next, points + j, p * q);
      });
    }
    layer = next;
  }
  return { gain, bust, wipe };
}

/**
 * Сколько ходов на каждого займёт партия: { median, long } — к какому кругу партия кончается
 * в половине случаев и в девяти из десяти. null — дольше limit кругов (партия может не кончиться).
 */
export function estimateTurns(rules, seats = 2, { limit = 400 } = {}) {
  const odds = [null, 1, 2, 3, 4, 5, 6].map((n) => (n ? rollOdds(n) : null));
  const T = rules.target;
  const outcomes = Array.from({ length: T }, (_, s) => turnOutcome(rules, s, odds));
  const players = Math.max(2, seats);
  let dist = new Float64Array(T);
  dist[0] = 1;
  let done = 0;
  let median = null;
  for (let round = 1; round <= limit; round++) {
    const next = new Float64Array(T);
    for (let s = 0; s < T; s++) {
      const m = dist[s];
      if (m < 1e-12) continue;
      const o = outcomes[s];
      next[s] += m * o.bust;
      next[0] += m * o.wipe;
      for (const [g, q] of o.gain) {
        if (s + g >= T) done += m * q;
        else next[s + g] += m * q;
      }
    }
    dist = next;
    // Партия кончается, как только до цели дошёл хоть кто-то.
    const over = 1 - (1 - done) ** players;
    if (median === null && over >= 0.5) median = round;
    if (over >= 0.9) return { median, long: round };
  }
  return { median, long: null };
}

export default function decide({ view, seatId, temperament, rng }) {
  const { turn, rules, scores } = view;
  if (turn.rolls.length === 0) return ROLL;

  const mine = scores[seatId] ?? 0;
  const rival = Math.max(0, ...view.order.filter((id) => id !== seatId).map((id) => scores[id] ?? 0));
  // Обычный ход — до порога, но не меньше одного удачного броска.
  const reach = RACE * Math.max(pace(breakEven(rules.dice, 0, false)), FACE * rules.dice);
  const near = (score) => rules.target - score <= reach;
  const race = near(rival) || (near(mine) && !rules.snakeEyes);

  const n = diceFor(rules, turn.rolls.length);
  const behind = ((rival - mine) / CATCH_UP) * (100 / rules.target);
  let goal = race ? rules.target - mine : (pace(breakEven(n, mine, rules.snakeEyes)) + behind) * temperament.greed;
  if (rng() > temperament.skill) goal *= 0.5 + rng();
  if (rules.maxTurns && view.turns[seatId] >= rules.maxTurns - 1) goal = Math.max(goal, rival - mine + 1);
  return turn.points >= goal ? HOLD : ROLL;
}

