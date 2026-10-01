/* Общие помощники ядра. Ничего из Foundry — всё это работает и в Node. */

/** Сидируемый генератор случайных чисел [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clone = (value) => structuredClone(value);

export const rollDie = (rng, sides) => 1 + Math.floor(rng() * sides);

export const sum = (values) => values.reduce((a, b) => a + b, 0);

/** Сколько раз выпала каждая грань: counts([1, 5, 5])[5] === 2. */
export function counts(values, sides = 6) {
  const c = new Array(sides + 1).fill(0);
  for (const v of values) c[v]++;
  return c;
}

/** Следующее место по кругу после fromId, которое подходит под условие. */
export function nextInOrder(order, fromId, isEligible = () => true) {
  const n = order.length;
  const start = order.indexOf(fromId);
  for (let k = 1; k <= n; k++) {
    const id = order[(start + k + n) % n];
    if (isEligible(id)) return id;
  }
  return null;
}

/** Первое место по порядку, которое подходит под условие. */
export function firstInOrder(order, isEligible = () => true) {
  return order.find(isEligible) ?? null;
}

export const chance = (rng, p) => rng() < p;

export function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/** Все подмножества индексов 0..n-1 (без пустого). n ≤ 6 — максимум 63 набора. */
export function subsets(n) {
  const out = [];
  for (let mask = 1; mask < 1 << n; mask++) {
    const idx = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) idx.push(i);
    out.push(idx);
  }
  return out;
}

/**
 * Приводит сырые настройки к описанию игры: значения по умолчанию,
 * числа в границах, выбор только из списка.
 */
export function normalizeBySchema(schema, raw = {}) {
  const out = {};
  for (const opt of schema) {
    let v = raw?.[opt.key];
    if (opt.type === "number") {
      v = Number(v);
      if (!Number.isFinite(v)) v = opt.default;
      if (opt.step) v = Math.round(v / opt.step) * opt.step;
      v = clamp(v, opt.min ?? -Infinity, opt.max ?? Infinity);
    } else if (opt.type === "bool") {
      v = typeof v === "boolean" ? v : opt.default;
    } else if (opt.type === "select") {
      v = opt.choices.includes(v) ? v : opt.default;
    }
    out[opt.key] = v;
  }
  return out;
}
