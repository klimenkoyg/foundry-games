/* Имитация API Foundry VTT для стенда: ровно то, чем пользуется модуль.
   Это НЕ Foundry — только чтобы прогнать настоящий код модуля в браузере без установки. */
(() => {
  "use strict";
  const MODULE = "ssl_tavern_games";
  const clone = (v) => (v === undefined ? v : structuredClone(v));

  /* ---------- Hooks ---------- */
  const Hooks = {
    _h: {},
    on(name, fn) { (this._h[name] ??= []).push(fn); return fn; },
    once(name, fn) { const w = (...a) => { this.off(name, w); return fn(...a); }; return this.on(name, w); },
    off(name, fn) { this._h[name] = (this._h[name] ?? []).filter((f) => f !== fn); },
    callAll(name, ...args) { for (const fn of [...(this._h[name] ?? [])]) fn(...args); return true; },
    call(name, ...args) { return this.callAll(name, ...args); },
  };

  /* ---------- мир: актёры, токены, пользователи ---------- */
  const img = (n) => `/dev/design/portraits/${n}.svg`;
  const actors = new Map();
  function makeActor(id, name, pic, { owners = [], gp = 0, sp = 0, slt = 2, prc = 12 } = {}) {
    const actor = {
      id,
      uuid: `Actor.${id}`,
      name,
      img: img(pic),
      system: { currency: { pp: 0, gp, ep: 0, sp, cp: 0 }, skills: { slt: { total: slt }, prc: { passive: prc } } },
      prototypeToken: { name, texture: { src: img(pic) } },
      testUserPermission: (user) => user.isGM || owners.includes(user.id),
      async update(data) {
        for (const [key, value] of Object.entries(data)) {
          const path = key.split(".");
          let target = actor;
          while (path.length > 1) target = target[path.shift()];
          target[path[0]] = clone(value);
        }
        window.__harness?.onWorldChange?.();
        return actor;
      },
    };
    actors.set(actor.uuid, actor);
    return actor;
  }
  const A = {
    mira: makeActor("mira", "Мира", "mira", { owners: ["u-yura"], gp: 37, sp: 12 }),
    ilva: makeActor("ilva", "Ильва", "ilva", { owners: ["u-katya"], gp: 20 }),
    martin: makeActor("martin", "Старый Мартин", "martin", { gp: 120 }),
    brenna: makeActor("brenna", "Бренна", "brenna", { gp: 9, sp: 40 }),
    hale: makeActor("hale", "Хейл «Два медяка»", "hale", { gp: 2 }),
    bram: makeActor("bram", "Брам Счетовод", "bram", { gp: 64 }),
    tobias: makeActor("tobias", "Староста Тобиас", "tobias", { gp: 15 }),
  };

  const tokens = Object.entries(A).map(([key, actor]) => ({
    id: `t-${key}`,
    uuid: `Scene.tavern.Token.t-${key}`,
    name: actor.name,
    texture: { src: actor.img },
    actor,
    hidden: false,
  }));
  const tokenByUuid = new Map(tokens.map((tk) => [tk.uuid, tk]));
  const controlled = new Set(["t-hale", "t-bram"]);

  const users = [];
  function makeUser(id, name, { isGM = false, character = null, active = true } = {}) {
    const user = {
      id,
      name,
      isGM,
      active,
      character,
      avatar: "icons/svg/mystery-man.svg",
      get isSelf() { return game.user === user; },
      // Сервер Foundry доставляет запрос адресату; здесь все «клиенты» живут на одной странице.
      query(name_, data) {
        const handler = CONFIG.queries[name_];
        return new Promise((resolve, reject) => {
          if (!handler) return reject(new Error(`нет обработчика ${name_}`));
          setTimeout(() => Promise.resolve(handler(clone(data))).then((r) => resolve(clone(r)), reject), 30);
        });
      },
    };
    users.push(user);
    return user;
  }
  const gm = makeUser("u-gm", "Ведущий", { isGM: true });
  makeUser("u-yura", "Юра", { character: A.mira });
  makeUser("u-katya", "Катя", { character: A.ilva });

  const collection = (list) => ({
    get: (id) => list.find((x) => x.id === id) ?? null,
    filter: (fn) => list.filter(fn),
    find: (fn) => list.find(fn),
    map: (fn) => list.map(fn),
    get contents() { return list; },
    [Symbol.iterator]: () => list[Symbol.iterator](),
  });

  /* ---------- настройки ---------- */
  const STORE_KEY = "tavern-harness-settings";
  const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}"); } catch { return {}; } })();
  const settings = {
    _reg: new Map(),
    register(ns, key, data) { this._reg.set(`${ns}.${key}`, data); },
    get(ns, key) {
      const k = `${ns}.${key}`;
      return k in saved ? clone(saved[k]) : clone(this._reg.get(k)?.default);
    },
    async set(ns, key, value) {
      const k = `${ns}.${key}`;
      saved[k] = clone(value);
      try { localStorage.setItem(STORE_KEY, JSON.stringify(saved)); } catch { /* приватный режим */ }
      this._reg.get(k)?.onChange?.(clone(value));
      return value;
    },
  };

  /* ---------- game, CONFIG, canvas, ui ---------- */
  const params = new URLSearchParams(location.search);
  window.Hooks = Hooks;
  window.CONFIG = { queries: {}, sounds: { dice: "" }, ChatMessage: { modes: { public: {}, gm: {} } } };
  window.game = {
    user: gm,
    users: Object.assign(collection(users), { get activeGM() { return gm; } }),
    settings,
    system: { id: params.get("system") ?? "dnd5e" },
    modules: { get: (id) => (id === MODULE ? (game._module ??= { id }) : null) },
    i18n: {
      lang: params.get("lang") ?? "ru",
      translations: {},
      _find(key) { return key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), this.translations); },
      localize(key) { const v = this._find(key); return typeof v === "string" ? v : key; },
      has(key) { return typeof this._find(key) === "string"; },
    },
    dice3d: null,
  };
  window.canvas = {
    scene: { name: "Трактир «Сломанное колесо»", tokens: collection(tokens) },
    tokens: { get controlled() { return tokens.filter((tk) => controlled.has(tk.id)).map((document) => ({ document })); } },
  };
  window.fromUuidSync = (uuid) => tokenByUuid.get(uuid) ?? actors.get(uuid) ?? null;
  window.fromUuid = async (uuid) => window.fromUuidSync(uuid);
  window.ui = {
    notifications: Object.fromEntries(["info", "warn", "error"].map((level) => [level, (msg) => window.__harness?.toast?.(level, msg)])),
  };
  window.ChatMessage = { create: async (data) => { window.__harness?.chat?.(data); return { id: Math.random().toString(36).slice(2) }; } };

  window.Roll = class Roll {
    constructor(formula) { this.formula = formula; this.dice = []; }
    async evaluate() {
      this.dice = this.formula.split("+").map((part) => {
        const [count, sides] = part.trim().split("d").map(Number);
        return { faces: sides, results: Array.from({ length: count }, () => ({ result: 1 + Math.floor(Math.random() * sides), active: true })) };
      });
      return this;
    }
    async toMessage(data) { return ChatMessage.create({ content: `<p>🎲 ${this.formula}: ${this.dice.map((d) => d.results.map((r) => r.result).join(", ")).join(" | ")}</p>`, ...data }); }
  };

  /* ---------- Handlebars: помощники Foundry ---------- */
  Handlebars.registerHelper("localize", (key) => game.i18n.localize(key));
  Handlebars.registerHelper("checked", (value) => (value ? "checked" : ""));
  const templateCache = new Map();
  const templateUrl = (path) => `/${path.replace(`modules/${MODULE}/`, "")}`;
  async function getTemplate(path) {
    if (!templateCache.has(path)) {
      const res = await fetch(templateUrl(path), { cache: "no-store" });
      if (!res.ok) throw new Error(`шаблон не найден: ${path}`);
      templateCache.set(path, Handlebars.compile(await res.text()));
    }
    return templateCache.get(path);
  }

  /* ---------- ApplicationV2 ---------- */
  function merge(a, b) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b ?? {})) {
      out[k] = v && typeof v === "object" && !Array.isArray(v) && typeof a?.[k] === "object" && !Array.isArray(a[k]) ? merge(a[k], v) : v;
    }
    return out;
  }
  const instances = new Map();
  let z = 100;

  class ApplicationV2 {
    static DEFAULT_OPTIONS = {};
    constructor(options = {}) {
      const chain = [];
      for (let c = this.constructor; c && c !== Object; c = Object.getPrototypeOf(c)) {
        if (Object.hasOwn(c, "DEFAULT_OPTIONS")) chain.unshift(c.DEFAULT_OPTIONS);
      }
      this.options = [...chain, options].reduce(merge, {});
      this.position = { ...(this.options.position ?? {}) };
      this.element = null;
      this.rendered = false;
    }
    get id() { return this.options.id ?? (this._autoId ??= `app-${Math.random().toString(36).slice(2)}`); }
    get title() { return this.options.window?.title ?? ""; }

    async render(options = {}) {
      this._queue = (this._queue ?? Promise.resolve()).then(() => this.#render(options)).catch((err) => {
        console.error(err);
        window.__harness?.toast?.("error", `Ошибка отрисовки: ${err.message}`);
      });
      return this._queue;
    }

    async #render(options) {
      const first = !this.element;
      // Как в Foundry: закрытое окно без force не открывается заново.
      if (first && !options.force) return this;
      if (first) {
        this.element = await this._renderFrame(options);
        document.querySelector("#windows").append(this.element);
        instances.set(this.id, this);
      }
      const context = await this._prepareContext(options);
      if (!this.element) return this;
      await this._renderHTML(context, options);
      if (!this.element) return this;
      this.element.querySelector(".window-title").textContent = this.title;
      this.rendered = true;
      if (first) await this._onFirstRender(context, options);
      await this._onRender(context, options);
      return this;
    }

    async _renderFrame() {
      const el = document.createElement("div");
      el.id = this.id;
      el.className = ["application", ...(this.options.classes ?? [])].join(" ");
      const { width, left, top } = this.position;
      el.style.cssText = `width:${typeof width === "number" ? `${width}px` : "auto"};left:${left ?? 16 + instances.size * 28}px;top:${top ?? 12 + instances.size * 28}px;z-index:${++z}`;
      el.innerHTML = `
        <header class="window-header">
          <i class="window-icon ${this.options.window?.icon ?? ""}"></i>
          <h1 class="window-title"></h1>
          <button type="button" class="header-control fa-solid fa-xmark" data-action="close" aria-label="Закрыть"></button>
        </header>
        <section class="window-content"></section>`;
      el.addEventListener("pointerdown", () => this.bringToFront());
      el.addEventListener("click", (event) => {
        const target = event.target.closest("[data-action]");
        if (!target || !el.contains(target)) return;
        const action = target.dataset.action;
        if (action === "close") return this.close();
        const entry = this.options.actions?.[action];
        const handler = typeof entry === "function" ? entry : entry?.handler;
        if (!handler) return console.warn(`нет действия «${action}»`);
        Promise.resolve(handler.call(this, event, target)).catch((err) => {
          console.error(err);
          window.__harness?.toast?.("error", `Ошибка действия «${action}»: ${err.message}`);
        });
      });
      // перетаскивание окна за шапку
      const header = el.querySelector(".window-header");
      header.addEventListener("pointerdown", (ev) => {
        if (ev.target.closest("button")) return;
        const start = { x: ev.clientX, y: ev.clientY, left: el.offsetLeft, top: el.offsetTop };
        const move = (e) => { el.style.left = `${start.left + e.clientX - start.x}px`; el.style.top = `${Math.max(0, start.top + e.clientY - start.y)}px`; };
        const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
      return el;
    }

    async _prepareContext() { return {}; }
    async _renderHTML() {}
    _onFirstRender() {}
    _onRender() {}
    _onClose() {}
    bringToFront() { if (this.element) this.element.style.zIndex = ++z; }
    async close(options = {}) {
      if (!this.element) return this;
      this.element.remove();
      this.element = null;
      this.rendered = false;
      instances.delete(this.id);
      this._onClose(options);
      return this;
    }
  }

  const HandlebarsApplicationMixin = (Base) =>
    class extends Base {
      _configureRenderParts() { return clone(this.constructor.PARTS); }
      async _preparePartContext(partId, context) { return context; }
      async _renderHTML(context, options) {
        const parts = this._configureRenderParts(options);
        const content = this.element.querySelector(".window-content");
        for (const [id, part] of Object.entries(parts)) {
          if (options.parts && !options.parts.includes(id)) continue;
          const template = await getTemplate(part.template);
          const partContext = await this._preparePartContext(id, { ...context }, options);
          if (!this.element) return;
          const holder = document.createElement("template");
          holder.innerHTML = template(partContext, { allowProtoPropertiesByDefault: true, allowProtoMethodsByDefault: true }).trim();
          if (holder.content.children.length !== 1) throw new Error(`Часть «${id}» должна давать ровно один корневой элемент (сейчас ${holder.content.children.length})`);
          const el = holder.content.firstElementChild;
          el.dataset.applicationPart = id;
          const prev = content.querySelector(`:scope > [data-application-part="${id}"]`);
          if (prev) prev.replaceWith(el);
          else content.append(el);
        }
      }
    };

  /* ---------- DialogV2 ---------- */
  const DialogV2 = {
    wait({ window: win, content, buttons }) {
      return new Promise((resolve) => {
        const back = document.createElement("div");
        back.className = "mock-dialog";
        back.innerHTML = `<form><h3>${win?.title ?? ""}</h3><div class="mock-dialog__body">${content ?? ""}</div><footer></footer></form>`;
        const form = back.querySelector("form");
        form.addEventListener("submit", (e) => e.preventDefault());
        for (const b of buttons) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = b.label;
          btn.dataset.dialogAction = b.action;
          btn.addEventListener("click", async (event) => {
            const value = b.callback ? await b.callback(event, btn, null) : b.action;
            back.remove();
            resolve(value);
          });
          form.querySelector("footer").append(btn);
        }
        document.body.append(back);
      });
    },
    async confirm({ window: win, content }) {
      const res = await this.wait({ window: win, content, buttons: [{ action: "yes", label: "Да", callback: () => true }, { action: "no", label: "Нет", callback: () => false }] });
      return res;
    },
  };

  window.foundry = {
    utils: {
      deepClone: clone,
      randomID: (n = 16) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join(""),
      escapeHTML: (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c]),
    },
    audio: { AudioHelper: { play: () => {} } },
    applications: {
      instances,
      api: { ApplicationV2, HandlebarsApplicationMixin, DialogV2 },
      handlebars: {
        _pending: Promise.resolve(),
        loadTemplates(map) {
          this._pending = Promise.all(
            Object.entries(map).map(async ([name, path]) => {
              const res = await fetch(templateUrl(path), { cache: "no-store" });
              Handlebars.registerPartial(name, await res.text());
            }),
          );
          return this._pending;
        },
      },
    },
  };

  window.__mock = { users, tokens, controlled, actors: A, gm, reset() { localStorage.removeItem(STORE_KEY); location.reload(); } };
})();
