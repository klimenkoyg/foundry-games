/* Реестр затей: правила (ядро), бот и интерфейс. Сюда же позже лягут загадки. */

import farkleBot from "../core/bots/farkle.mjs";
import kbBot from "../core/bots/kb.mjs";
import liarsBot from "../core/bots/liars.mjs";
import pokerBot from "../core/bots/poker.mjs";
import sccBot from "../core/bots/scc.mjs";
import twBot from "../core/bots/tw.mjs";
import farkle from "../core/games/farkle.mjs";
import kb from "../core/games/kb.mjs";
import liars from "../core/games/liars.mjs";
import poker from "../core/games/poker.mjs";
import scc from "../core/games/scc.mjs";
import tw from "../core/games/tw.mjs";
import farkleUi from "./games/farkle.mjs";
import kbUi from "./games/kb.mjs";
import liarsUi from "./games/liars.mjs";
import pokerUi from "./games/poker.mjs";
import sccUi from "./games/scc.mjs";
import twUi from "./games/tw.mjs";

const GAMES = new Map();

function register(rules, bot, ui) {
  GAMES.set(rules.id, { id: rules.id, kind: "game", rules, bot, ui });
}

// Порядок — как в лобби.
register(farkle, farkleBot, farkleUi);
register(liars, liarsBot, liarsUi);
register(poker, pokerBot, pokerUi);
register(kb, kbBot, kbUi);
register(tw, twBot, twUi);
register(scc, sccBot, sccUi);

export const getGame = (id) => GAMES.get(id) ?? null;

export const listGames = () => [...GAMES.values()];
