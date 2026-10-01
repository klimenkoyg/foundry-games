/* Нравы ботов — общие для всех игр.
   greed  — насколько долго тянет: 1 — разумно, <1 — рано останавливается, >1 — рискует.
   skill  — как часто играет верно (иначе ошибается наугад).
   bluff  — склонность к блефу и повышению ставок. */

export const TEMPERAMENTS = {
  cautious: { greed: 0.7, skill: 0.85, bluff: 0.15, icon: "fa-shield-halved" },
  reckless: { greed: 1.6, skill: 0.65, bluff: 0.55, icon: "fa-fire" },
  counter: { greed: 1.0, skill: 0.95, bluff: 0.25, icon: "fa-scale-balanced" },
  simple: { greed: 1.15, skill: 0.45, bluff: 0.3, icon: "fa-wheat-awn" },
};

export const TEMPERAMENT_IDS = Object.keys(TEMPERAMENTS);

export const DEFAULT_TEMPERAMENT = "cautious";

export function temperament(id) {
  return { id: TEMPERAMENTS[id] ? id : DEFAULT_TEMPERAMENT, ...(TEMPERAMENTS[id] ?? TEMPERAMENTS[DEFAULT_TEMPERAMENT]) };
}
