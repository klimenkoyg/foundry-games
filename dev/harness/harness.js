/* Стенд: запускает настоящий модуль поверх имитации Foundry. */

const $ = (s) => document.querySelector(s);
const { users, tokens, controlled, actors, reset } = window.__mock;

function toast(level, message) {
  const el = document.createElement("div");
  el.className = `toast ${level}`;
  el.textContent = message;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 3500);
}

function chat(data) {
  const el = document.createElement("div");
  el.className = "msg";
  el.innerHTML = `<header>${data.speaker?.alias ?? ""}</header>${data.content ?? ""}`;
  $("#chat-log").prepend(el);
}

function renderWallets() {
  $("#wallets").innerHTML = Object.values(actors)
    .map((a) => `<div><span>${a.name}</span><b>${a.system.currency.gp} зм · ${a.system.currency.sp} см</b></div>`)
    .join("");
}

window.__harness = { toast, chat, onWorldChange: renderWallets };

game.i18n.translations = await (await fetch(`/lang/${game.i18n.lang}.json`, { cache: "no-store" })).json();
await import("/scripts/main.mjs");
Hooks.callAll("init");
await foundry.applications.handlebars._pending;
Hooks.callAll("ready");

const { Manager } = await import("/scripts/foundry/manager.mjs");

/* ---------- кто смотрит ---------- */
function setUser(user) {
  game.user = user;
  for (const b of document.querySelectorAll("[data-user]")) b.setAttribute("aria-pressed", String(b.dataset.user === user.id));
  Manager.refresh();
  for (const app of foundry.applications.instances.values()) app.render();
}
for (const user of users) {
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.user = user.id;
  b.textContent = user.character ? `${user.name} (${user.character.name})` : user.name;
  b.addEventListener("click", () => setUser(user));
  $("#users").append(b);
}
setUser(game.user);

/* ---------- кнопка на панели сцены ---------- */
$("#open-panel").addEventListener("click", () => {
  const controls = { tokens: { tools: {} } };
  Hooks.callAll("getSceneControlButtons", controls);
  controls.tokens.tools.tavernGames.onChange();
});

/* ---------- выделение токенов и меню токена ---------- */
for (const tk of tokens) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = tk.name.split(" ")[0];
  b.setAttribute("aria-pressed", String(controlled.has(tk.id)));
  b.addEventListener("click", () => {
    controlled.has(tk.id) ? controlled.delete(tk.id) : controlled.add(tk.id);
    b.setAttribute("aria-pressed", String(controlled.has(tk.id)));
    Hooks.callAll("controlToken");
  });
  $("#tokens").append(b);
  $("#hud-token").add(new Option(tk.name, tk.uuid));
}
$("#hud").addEventListener("click", () => {
  const html = document.createElement("div");
  html.innerHTML = '<div class="col right"></div>';
  Hooks.callAll("renderTokenHUD", { document: tokens.find((tk) => tk.uuid === $("#hud-token").value) }, html);
  html.querySelector("[data-tavern-seat]")?.click();
});

// высота шапки стенда — окна начинаются под ней
const bar = $(".hbar");
new ResizeObserver(() => document.documentElement.style.setProperty("--bar-h", `${bar.offsetHeight}px`)).observe(bar);

$("#reload").addEventListener("click", () => location.reload());
$("#reset").addEventListener("click", reset);
renderWallets();

/* Для автоматических проверок из консоли. */
window.__tavern = {
  Manager,
  Host: (await import("/scripts/foundry/host.mjs")).Host,
  Store: (await import("/scripts/foundry/store.mjs")).Store,
  setUser: (id) => setUser(users.find((u) => u.id === id)),
};

/* ---------- помощники для проверок ---------- */
const errors = [];
const originalError = console.error;
console.error = (...args) => {
  errors.push(args.map((x) => x?.stack ?? String(x)).join(" ").slice(0, 600));
  originalError(...args);
};
window.addEventListener("unhandledrejection", (e) => errors.push(`unhandled: ${e.reason?.stack ?? e.reason}`));
window.addEventListener("error", (e) => errors.push(`error: ${e.message}`));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OWNER = { mira: "u-yura", ilva: "u-katya" };

Object.assign(window.__tavern, {
  errors,
  wait,
  /** Место из токена стенда: seat("mira", "user"), seat("hale", "bot", "reckless"), seat("bram", "gm"). */
  seat(key, control = "bot", temperament = "cautious") {
    const tk = tokens.find((x) => x.id === `t-${key}`);
    const player = control === "user";
    return {
      id: foundry.utils.randomID(8),
      name: tk.name,
      img: tk.texture.src,
      tokenUuid: tk.uuid,
      actorUuid: tk.actor.uuid,
      userId: player ? OWNER[key] : null,
      kind: player ? "player" : "npc",
      control,
      temperament,
    };
  },
  /** Убрать все столы и собрать новый. */
  async make(gameId, seats, { options = {}, theme = "tavern", stake = 5 } = {}) {
    const { Host, Store } = window.__tavern;
    setUser(users[0]);
    for (const table of Store.list()) await Host.removeTable(table.id);
    const res = await Host.createTable({
      gameId,
      title: "Трактир",
      theme,
      seats,
      options,
      stake: { amount: stake, coin: "gp", fromSheets: true, npcPays: "sheet" },
    });
    await wait(600);
    const el = document.querySelector('[id^="tavern-table"]');
    if (el) Object.assign(el.style, { left: "10px", top: "10px" });
    return res;
  },
  table: () => window.__tavern.Store.list()[0],
  win: () => document.querySelector('[id^="tavern-table"]'),
});

// ?hostile=1 — «враждебные» стили по умолчанию, как у Foundry: проверка, что окна их перекрывают.
if (new URLSearchParams(location.search).has("hostile")) {
  document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "hostile.css" }));
}

// ?bare=1 — без панели стенда, для снимков окон.
if (new URLSearchParams(location.search).has("bare")) {
  $(".hbar").hidden = true;
  $("#side").hidden = true;
  Object.assign($("#windows").style, { top: "0", right: "0" });
}

// ?do=<js> — сценарий для снимка окна: выполняется после загрузки стенда, tavern = window.__tavern.
const scenario = new URLSearchParams(location.search).get("do");
if (scenario) {
  try {
    await new Function("tavern", `return (async () => { ${scenario} })()`)(window.__tavern);
  } catch (err) {
    console.error(err);
  }
  document.documentElement.dataset.scenario = "done";
}
