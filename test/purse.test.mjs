import assert from "node:assert/strict";
import { test } from "node:test";

import { canAfford, deduct, normalizePurse, totalCopper } from "../scripts/core/purse.mjs";
import { mulberry32 } from "../scripts/core/util.mjs";

const purse = (p) => normalizePurse(p);

test("хватает нужной монеты — берём её", () => {
  assert.deepEqual(deduct(purse({ gp: 10 }), 3, "gp"), purse({ gp: 7 }));
});

test("не хватает денег — null, вход не тронут", () => {
  const p = purse({ gp: 1, sp: 5 });
  assert.equal(deduct(p, 2, "gp"), null);
  assert.deepEqual(p, purse({ gp: 1, sp: 5 }));
});

test("добираем мелочью", () => {
  assert.deepEqual(deduct(purse({ gp: 1, sp: 25 }), 3, "gp"), purse({ sp: 5 }));
});

test("размен крупной монеты со сдачей той же монетой", () => {
  assert.deepEqual(deduct(purse({ pp: 1 }), 3, "gp"), purse({ gp: 7 }));
  assert.deepEqual(deduct(purse({ gp: 3 }), 25, "sp"), purse({ sp: 5 }));
});

test("сдача мелочью, когда монетой ставки не выходит", () => {
  assert.deepEqual(deduct(purse({ sp: 1 }), 3, "cp"), purse({ cp: 7 }));
});

test("canAfford и нормализация мусора", () => {
  assert.equal(canAfford(purse({ gp: 1 }), 10, "sp"), true);
  assert.equal(canAfford(purse({ gp: 1 }), 11, "sp"), false);
  assert.deepEqual(purse({ gp: "3", sp: -2, cp: null }), { pp: 0, gp: 3, ep: 0, sp: 0, cp: 0 });
});

test("сумма всегда сходится до медяка на случайных кошельках", () => {
  const rng = mulberry32(42);
  const coins = ["pp", "gp", "ep", "sp", "cp"];
  const value = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };
  for (let i = 0; i < 20000; i++) {
    const p = purse(Object.fromEntries(coins.map((c) => [c, Math.floor(rng() * 6)])));
    const coin = coins[Math.floor(rng() * 5)];
    const amount = 1 + Math.floor(rng() * 12);
    const out = deduct(p, amount, coin);
    if (totalCopper(p) < amount * value[coin]) {
      assert.equal(out, null);
      continue;
    }
    assert.notEqual(out, null);
    assert.equal(totalCopper(out), totalCopper(p) - amount * value[coin]);
    for (const c of coins) assert.ok(out[c] >= 0 && Number.isInteger(out[c]));
  }
});
