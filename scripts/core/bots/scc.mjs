/* Бот «Корабля, капитана и команды».
   Без команды — бросает всегда. С командой решает, оставить ли груз:
   сравнивает с лучшим грузом соперников и с порогом по нраву. */

import { sum } from "../util.mjs";

export default function decide({ view, seatId, temperament, rng }) {
  const hand = view.hands[seatId];
  if (!hand.crew || hand.rolls === 0) return { type: "roll" };

  const left = view.maxRolls - hand.rolls;
  const cargo = sum(hand.dice);
  if (left <= 0) return { type: "stop" };

  const others = view.contenders.filter((id) => id !== seatId);
  const doneScores = others.filter((id) => view.hands[id].done).map((id) => view.hands[id].score ?? 0);
  const bestOther = Math.max(0, ...doneScores);
  const allOthersDone = doneScores.length === others.length;

  // Последним ходит — знает, сколько нужно побить.
  if (allOthersDone) return { type: cargo > bestOther ? "stop" : "roll" };

  // Средний груз двух костей — 7; с лишним броском в запасе можно ждать большего.
  const base = left >= 2 ? 9 : 8;
  const threshold = Math.round(base + (temperament.greed - 1) * 2.5);
  let stop = cargo >= threshold && cargo > bestOther;
  if (rng() > temperament.skill) stop = rng() < 0.5;
  return { type: stop ? "stop" : "roll" };
}
