/* Места за столом: из токена на сцене, из актёра, из игрока.
   Имя и портрет берутся из токена; токен, которым владеет игрок, садит этого игрока. */

import { DEFAULT_TEMPERAMENT } from "../core/temperaments.mjs";

const FALLBACK_IMG = "icons/svg/mystery-man.svg";
const VIDEO = /\.(webm|mp4|m4v|ogv)(\?.*)?$/i;

const usable = (src) => Boolean(src) && !src.includes("*") && !VIDEO.test(src);

/** Игроки (не ведущие), у которых есть права владельца на актёра. */
export function playerOwners(actor) {
  if (!actor) return [];
  return game.users.filter((u) => !u.isGM && actor.testUserPermission(u, "OWNER"));
}

/** Кто из владельцев сядет: тот, чей это персонаж, иначе кто в сети, иначе первый. */
function pickOwner(actor) {
  const owners = playerOwners(actor);
  if (!owners.length) return null;
  return owners.find((u) => u.character?.id === actor.id) ?? owners.find((u) => u.active) ?? owners[0];
}

function makeSeat({ name, img, tokenUuid = null, actorUuid = null, userId = null }) {
  const player = Boolean(userId);
  return {
    id: foundry.utils.randomID(8),
    name: name || "?",
    img: img || FALLBACK_IMG,
    tokenUuid,
    actorUuid,
    userId,
    kind: player ? "player" : "npc",
    control: player ? "user" : "bot",
    temperament: DEFAULT_TEMPERAMENT,
    left: false,
  };
}

export function tokenImage(tokenDoc) {
  const src = tokenDoc?.texture?.src;
  if (usable(src)) return src;
  return tokenDoc?.actor?.img || FALLBACK_IMG;
}

export function seatFromToken(tokenDoc) {
  const actor = tokenDoc.actor;
  return makeSeat({
    name: tokenDoc.name,
    img: tokenImage(tokenDoc),
    tokenUuid: tokenDoc.uuid,
    actorUuid: actor?.uuid ?? null,
    userId: pickOwner(actor)?.id ?? null,
  });
}

export function seatFromActor(actor) {
  const proto = actor.prototypeToken;
  return makeSeat({
    name: proto?.name || actor.name,
    img: usable(proto?.texture?.src) ? proto.texture.src : actor.img,
    actorUuid: actor.uuid,
    userId: pickOwner(actor)?.id ?? null,
  });
}

/** Игрок без токена на сцене садится под именем своего персонажа. */
export function seatFromUser(user) {
  const actor = user.character;
  const tokenDoc = actor ? canvas?.scene?.tokens.find((t) => t.actor?.id === actor.id) : null;
  if (tokenDoc) return { ...seatFromToken(tokenDoc), userId: user.id, kind: "player", control: "user" };
  const proto = actor?.prototypeToken;
  return makeSeat({
    name: actor?.name ?? user.name,
    img: usable(proto?.texture?.src) ? proto.texture.src : actor?.img || user.avatar,
    actorUuid: actor?.uuid ?? null,
    userId: user.id,
  });
}

/** Лист персонажа места: актёр токена (у несвязанного — свой, синтетический), иначе актёр, иначе персонаж игрока. */
export function seatActor(seat) {
  if (seat.tokenUuid) {
    const actor = fromUuidSync(seat.tokenUuid)?.actor;
    if (actor) return actor;
  }
  if (seat.actorUuid) {
    const actor = fromUuidSync(seat.actorUuid);
    if (actor) return actor;
  }
  if (seat.userId) return game.users.get(seat.userId)?.character ?? null;
  return null;
}

/** Тёзок разводим номером: «Стражник», «Стражник 2». */
export function uniqueName(name, taken) {
  if (!taken.includes(name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} ${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/** Может ли пользователь ходить за это место. */
export function canUserAct(user, seat) {
  if (!user || !seat || seat.left) return false;
  if (seat.control === "user") {
    if (seat.userId === user.id) return true;
    // Игрок вышел из мира — за него может сходить ведущий.
    return user.isGM && !game.users.get(seat.userId)?.active;
  }
  if (seat.control === "gm") return user.isGM;
  return false;
}

/** Место этого пользователя за столом (первое, если их несколько). */
export function seatOfUser(table, user) {
  return table.seats.find((s) => !s.left && s.control === "user" && s.userId === user.id) ?? null;
}
