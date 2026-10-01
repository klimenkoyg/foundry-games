/* Черновое поведение макета: только чтобы почувствовать окна и анимации.
   Настоящая логика игр будет в scripts/core/games/*.mjs и проверена тестами. */
(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const rnd = (n) => 1 + Math.floor(Math.random() * n);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
  };

  /* ---------------- общие помощники ---------------- */

  const motionOn = () =>
    !document.body.classList.contains("no-motion") &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setFace(el, f) {
    el.dataset.face = f;
    el.setAttribute("aria-label", `кость: ${f}`);
  }

  function pipify(el) {
    if (el.childElementCount) return;
    for (let i = 0; i < 6; i++) el.appendChild(document.createElement("i"));
  }

  function makeDie(face, { tag = "span", cls = "" } = {}) {
    const el = document.createElement(tag);
    if (tag === "button") el.type = "button";
    el.className = `tg-die ${cls}`.trim();
    setFace(el, face);
    pipify(el);
    return el;
  }

  function scatter(el) {
    el.style.setProperty("--rot", `${(Math.random() * 26 - 13).toFixed(1)}deg`);
    el.style.setProperty("--dx", `${(Math.random() * 10 - 5).toFixed(1)}px`);
    el.style.setProperty("--dy", `${(Math.random() * 14 - 7).toFixed(1)}px`);
  }

  function rollDie(el, final, delay = 0) {
    return new Promise((res) => {
      if (!motionOn()) { setFace(el, final); res(); return; }
      setTimeout(() => {
        el.classList.remove("is-rolling");
        void el.offsetWidth;
        el.classList.add("is-rolling");
        let n = 0;
        const t = setInterval(() => {
          setFace(el, rnd(6));
          if (++n >= 7) { clearInterval(t); setFace(el, final); }
        }, 78);
        setTimeout(() => { el.classList.remove("is-rolling"); res(); }, 650);
      }, delay);
    });
  }

  function pop(anchor, text) {
    const host = anchor.closest(".tg-felt") ?? anchor.closest(".tg-seat") ?? anchor.parentElement;
    const a = anchor.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    const el = document.createElement("span");
    el.className = "tg-score-pop";
    el.textContent = text;
    el.style.left = `${a.left - h.left + a.width / 2 - 20}px`;
    el.style.top = `${a.top - h.top - 6}px`;
    host.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  function bump(el) {
    el.classList.remove("is-bump");
    void el.offsetWidth;
    el.classList.add("is-bump");
  }

  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  };

  /* ---------------- тема и анимации ---------------- */

  function setTheme(theme) {
    $$(".tavern-games").forEach((w) => (w.dataset.tgTheme = theme));
    $$("[data-theme-btn]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeBtn === theme)));
    store.set("tg-mock-theme", theme);
  }

  function setMotion(on) {
    document.body.classList.toggle("no-motion", !on);
    $$(".tavern-games").forEach((w) => w.classList.toggle("tg-no-motion", !on));
    $$("[data-motion-btn]").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.motionBtn === "on") === on)));
  }

  $$("[data-theme-btn]").forEach((b) => b.addEventListener("click", () => setTheme(b.dataset.themeBtn)));
  $$("[data-motion-btn]").forEach((b) => b.addEventListener("click", () => setMotion(b.dataset.motionBtn === "on")));

  // сегментные переключатели общего вида
  $$("[data-seg]").forEach((seg) =>
    seg.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      $$("button", seg).forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    }),
  );

  /* ---------------- многогранники ---------------- */

  const POLY = {
    d4: { face: "28,4 54,50 2,50", facets: ["28,4 28,36", "2,50 28,36", "54,50 28,36"], ny: "5px" },
    d6: { rect: true },
    d8: { face: "28,2 54,28 28,54 2,28", facets: ["2,28 54,28"] },
    d10: { face: "28,2 53,23 28,54 3,23", facets: ["3,23 28,33 53,23", "28,33 28,54"], ny: "-2px" },
    d12: { face: "28,3 53,21 44,51 12,51 3,21", facets: ["28,13 42,23 37,40 19,40 14,23 28,13", "28,3 28,13", "53,21 42,23", "44,51 37,40", "12,51 19,40", "3,21 14,23"] },
    d20: { face: "28,2 52,15 52,41 28,54 4,41 4,15", facets: ["28,13 46,40 10,40 28,13", "28,2 28,13", "52,15 28,13", "52,15 46,40", "52,41 46,40", "28,54 46,40", "28,54 10,40", "4,41 10,40", "4,15 10,40", "4,15 28,13"], ny: "4px", scale: 0.86 },
  };
  const SIDES = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20 };

  function polySvg(kind) {
    const d = POLY[kind];
    const face = d.rect
      ? `<rect class="face" x="5" y="5" width="46" height="46" rx="9"/>`
      : `<polygon class="face" points="${d.face}"/>`;
    const facets = (d.facets ?? []).map((p) => `<polyline class="facet" points="${p}"/>`).join("");
    return `<svg viewBox="0 0 56 56" aria-hidden="true">${face}${facets}</svg>`;
  }

  function makePoly(kind, value, { tag = "button", sm = false, cap = true } = {}) {
    const el = document.createElement(tag);
    if (tag === "button") el.type = "button";
    el.className = `tg-poly${sm ? " tg-poly--sm" : ""}`;
    el.dataset.poly = kind;
    const d = POLY[kind];
    el.innerHTML = `${polySvg(kind)}<span class="tg-poly__num" style="translate: 0 ${d.ny ?? "0"}; ${d.scale ? `scale: ${d.scale}` : ""}">${value ?? ""}</span>${cap ? `<span class="tg-poly__cap">к${SIDES[kind]}</span>` : ""}`;
    el.setAttribute("aria-label", `к${SIDES[kind]}${value ? `: ${value}` : ""}`);
    return el;
  }

  function rollPoly(el, sides, final) {
    return new Promise((res) => {
      const num = $(".tg-poly__num", el);
      if (!motionOn()) { num.textContent = final; res(); return; }
      el.classList.remove("is-rolling");
      void el.offsetWidth;
      el.classList.add("is-rolling");
      let n = 0;
      const t = setInterval(() => {
        num.textContent = rnd(sides);
        if (++n >= 7) { clearInterval(t); num.textContent = final; }
      }, 78);
      setTimeout(() => { el.classList.remove("is-rolling"); res(); }, 650);
    });
  }

  /* ---------------- журнал ---------------- */

  function logLine(logEl, lastEl, html) {
    if (lastEl) lastEl.innerHTML = html;
    if (!logEl) return;
    const li = document.createElement("li");
    li.innerHTML = `${html} <time>сейчас</time>`;
    $$(".tg-die", li).forEach(pipify);
    logEl.prepend(li);
    const count = logEl.closest(".tg-log")?.querySelector(".tg-log__count");
    if (count) count.textContent = `журнал · ${logEl.children.length + 10}`;
  }

  /* =========================================================
     ЛОББИ
     ========================================================= */

  const LOBBY = {
    farkle: {
      title: "Кости",
      text: "Шесть костей: бросаешь, откладываешь то, что даёт очки, и решаешь — рискнуть оставшимися или записать набранное. Не выпало ничего — всё за ход сгорает. Первый, кто наберёт цель, забирает банк.",
      facts: ["fa-users|2–6 мест", "fa-robot|боты с нравом", "fa-coins|ставки с листов", "fa-hand-sparkles|шулерство (dnd5e)"],
      dice: [1, 5, 5, 2, 6, 3],
    },
    liars: {
      title: "Кости лжеца",
      text: "У каждого под стаканчиком пять костей, которые видит только он. По кругу ставят: «на столе не меньше четырёх пятёрок» — следующий повышает или говорит «Не верю!». Проигравший спор теряет кость; последний с костями забирает банк.",
      facts: ["fa-users|2–6 мест", "fa-eye-slash|скрытые кости", "fa-masks-theater|боты блефуют", "fa-magnifying-glass|Проницательность против Обмана"],
      dice: [5, 5, 1, 3],
    },
    poker: {
      title: "Покер на костях",
      text: "Пять костей и один переброс: оставь лучшее, перебрось остальное. Ставка до переброса и после, комбинации как в покере — от пары до пяти одинаковых. Партия — до двух выигранных рук из трёх.",
      facts: ["fa-users|2–4 места", "fa-coins|ставки: повысить, уравнять, пас", "fa-robot|боты с нравом"],
      dice: [4, 4, 4, 6, 6],
    },
    kb: {
      title: "Кнаклбоунс",
      text: "Дуэль на двух полях три на три. Выпавшую кость кладёшь в свою колонку: одинаковые кости в колонке множат очки, а у соперника в той же колонке такие же кости сбиваются. Игра кончается, когда чьё-то поле заполнено.",
      facts: ["fa-user-group|ровно 2 места", "fa-bolt|5 минут", "fa-robot|бот-соперник"],
      dice: [3, 3, 5],
    },
    tw: {
      title: "Двадцать одно",
      text: "Шесть кубиков — к4, к6, к8, к10, к12 и к20, — каждый можно взять раз за раунд. Бросил, прибавил, перевалил за 21 — проиграл раунд. Остановиться можно когда угодно. Партия — до трёх выигранных раундов.",
      facts: ["fa-users|2–6 мест", "fa-dice-d20|кубики к4…к20", "fa-robot|боты считают риск"],
      poly: [["d4", 3], ["d8", 6], ["d12", 9], ["d20", 14]],
    },
    scc: {
      title: "Корабль, капитан и команда",
      text: "Три броска пяти костей. Сначала нужен корабль — шестёрка, потом капитан — пятёрка, потом команда — четвёрка. Две оставшиеся кости — груз: его очки и решают, кто заберёт банк.",
      facts: ["fa-users|2–8 мест", "fa-bolt|быстрая", "fa-robot|боты с нравом"],
      dice: [6, 5, 4, 3, 6],
    },
  };

  function renderLobby(key) {
    const g = LOBBY[key];
    $("#lobby-title").textContent = g.title;
    $("#lobby-text").textContent = g.text;
    $("#lobby-facts").innerHTML = g.facts
      .map((f) => { const [i, t] = f.split("|"); return `<span class="tg-chip"><i class="fa-solid ${i}"></i> ${t}</span>`; })
      .join("");
    const prev = $("#lobby-preview");
    prev.innerHTML = "";
    if (g.poly) {
      g.poly.forEach(([k, v]) => { const p = makePoly(k, v, { tag: "span", cap: false }); prev.append(p); });
    } else {
      g.dice.forEach((f, i) => { const d = makeDie(f); scatter(d); prev.append(d); rollDie(d, f, i * 60); });
    }
    $$("#lobby-list button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.game === key)));
  }

  $("#lobby-list").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-game]");
    if (b) renderLobby(b.dataset.game);
  });

  /* =========================================================
     ПОСАДКА
     ========================================================= */

  const PEOPLE = {
    mira: { name: "Мира", img: "mira", kind: "player", who: "Юра" },
    ilva: { name: "Ильва", img: "ilva", kind: "player", who: "Катя" },
    martin: { name: "Старый Мартин", img: "martin", kind: "npc", temper: "cautious" },
    brenna: { name: "Бренна", img: "brenna", kind: "npc", temper: "reckless" },
    hale: { name: "Хейл «Два медяка»", img: "hale", kind: "npc", temper: "reckless" },
    bram: { name: "Брам Счетовод", img: "bram", kind: "npc", temper: "counter" },
    tobias: { name: "Староста Тобиас", img: "tobias", kind: "npc", temper: "simple" },
  };
  const TEMPERS = [
    ["cautious", "Осторожный"],
    ["reckless", "Безрассудный"],
    ["counter", "Счетовод"],
    ["simple", "Простак"],
  ];
  const seated = ["mira", "martin", "brenna"];
  const control = { martin: "bot", brenna: "bot" };

  function seatRow(id) {
    const p = PEOPLE[id];
    const li = document.createElement("li");
    li.className = "tg-seatrow";
    li.dataset.id = id;
    const npcControls = p.kind === "npc"
      ? `<div class="tg-seatrow__controls">
           <div class="tg-seg" data-control>
             <button type="button" data-v="bot" aria-pressed="${control[id] !== "gm"}"><i class="fa-solid fa-robot"></i> Бот</button>
             <button type="button" data-v="gm" aria-pressed="${control[id] === "gm"}"><i class="fa-solid fa-crown"></i> Ведущий</button>
           </div>
           <select class="tg-select" aria-label="Нрав" ${control[id] === "gm" ? "hidden" : ""}>
             ${TEMPERS.map(([k, t]) => `<option value="${k}" ${p.temper === k ? "selected" : ""}>${t}</option>`).join("")}
           </select>
         </div>`
      : "";
    li.innerHTML = `
      <span class="tg-seatrow__grip" title="Перетащить — порядок ходов"><i class="fa-solid fa-grip-vertical"></i></span>
      <span class="tg-portrait"><img src="portraits/${p.img}.svg" alt=""></span>
      <div class="tg-seatrow__main">
        <span class="tg-seatrow__name"><span>${p.name}</span>${p.kind === "player" ? `<span class="tg-chip tg-chip--accent"><i class="fa-solid fa-user"></i> ${p.who}</span>` : `<span class="tg-chip">NPC</span>`}</span>
        ${npcControls}
      </div>
      <button type="button" class="tg-seatrow__remove" aria-label="Убрать из-за стола"><i class="fa-solid fa-xmark"></i></button>`;
    return li;
  }

  function renderSeating() {
    const list = $("#seatlist");
    list.innerHTML = "";
    seated.forEach((id) => list.append(seatRow(id)));
    const n = seated.length;
    $("#seat-count").textContent = `${n} ${plural(n, "место", "места", "мест")}`;
    $("#seat-summary").textContent = `${n} ${plural(n, "место", "места", "мест")} · банк ${n * 5} зм`;
    $$(".tg-pick__item").forEach((item) => {
      const on = seated.includes(item.dataset.pick);
      item.classList.toggle("is-seated", on);
      $(".tg-pick__add", item).innerHTML = on ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-plus"></i>';
      const sub = $(".tg-pick__text span", item);
      sub.textContent = sub.textContent.replace(/ · за столом$/, "") + (on ? " · за столом" : "");
    });
    const sel = ["hale", "bram"].filter((id) => !seated.includes(id)).length;
    $("#take-selected").innerHTML = `<i class="fa-solid fa-object-group"></i> Взять выделенные · ${sel}`;
    $("#take-selected").disabled = sel === 0;
  }

  $("#seating").addEventListener("click", (e) => {
    const pick = e.target.closest(".tg-pick__item");
    if (pick && !seated.includes(pick.dataset.pick)) {
      seated.push(pick.dataset.pick);
      if (PEOPLE[pick.dataset.pick].kind === "npc") control[pick.dataset.pick] = "bot";
      renderSeating();
      return;
    }
    const rm = e.target.closest(".tg-seatrow__remove");
    if (rm) {
      const id = rm.closest(".tg-seatrow").dataset.id;
      seated.splice(seated.indexOf(id), 1);
      renderSeating();
      return;
    }
    const ctl = e.target.closest("[data-control] button");
    if (ctl) {
      const row = ctl.closest(".tg-seatrow");
      control[row.dataset.id] = ctl.dataset.v;
      $$("[data-control] button", row).forEach((b) => b.setAttribute("aria-pressed", String(b === ctl)));
      $("select", row).hidden = ctl.dataset.v === "gm";
      return;
    }
    if (e.target.closest("#take-selected")) {
      ["hale", "bram"].forEach((id) => { if (!seated.includes(id)) { seated.push(id); control[id] = "bot"; } });
      renderSeating();
    }
  });

  $("#token-search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase().replaceAll("ё", "е");
    $$("#pick-tokens .tg-pick__item").forEach((li) => {
      li.hidden = q && !$("b", li).textContent.toLowerCase().replaceAll("ё", "е").includes(q);
    });
  });

  /* =========================================================
     КОСТИ (FARKLE)
     ========================================================= */

  function farkleScore(vals) {
    if (!vals.length) return { score: 0, valid: false };
    const c = [0, 0, 0, 0, 0, 0, 0];
    vals.forEach((v) => c[v]++);
    if (vals.length === 6 && c.slice(1).every((x) => x === 1)) return { score: 1500, valid: true };
    let score = 0, used = 0;
    for (let f = 1; f <= 6; f++) {
      const n = c[f];
      if (n >= 3) { score += (f === 1 ? 1000 : f * 100) * 2 ** (n - 3); used += n; }
      else if (f === 1) { score += 100 * n; used += n; }
      else if (f === 5) { score += 50 * n; used += n; }
    }
    return { score, valid: used === vals.length && score > 0 };
  }
  const farkleHasScore = (vals) => {
    const c = [0, 0, 0, 0, 0, 0, 0];
    vals.forEach((v) => c[v]++);
    return c[1] > 0 || c[5] > 0 || c.some((n) => n >= 3) || (vals.length === 6 && c.slice(1).every((x) => x === 1));
  };

  const F = { rolled: [1, 4, 6], sel: new Set([0]), tray: [5, 5, 5], turn: 500, me: 650, martin: 900, busy: false };

  function farkleRender({ animate = false } = {}) {
    const box = $("#farkle-dice");
    box.innerHTML = "";
    const els = F.rolled.map((f, i) => {
      const d = makeDie(f, { tag: "button" });
      d.dataset.i = i;
      scatter(d);
      if (F.sel.has(i)) d.classList.add("is-selected");
      if (F.bust) d.classList.add("is-spent");
      box.append(d);
      return d;
    });
    const tray = $("#farkle-tray");
    tray.innerHTML = "";
    F.tray.forEach((f) => tray.append(makeDie(f, { cls: "tg-die--sm" })));
    $("#farkle-turn").textContent = F.turn;
    farkleUpdateSelection();
    if (animate) return Promise.all(els.map((d, i) => rollDie(d, F.rolled[i], i * 45)));
    return Promise.resolve();
  }

  function farkleUpdateSelection() {
    const vals = [...F.sel].map((i) => F.rolled[i]);
    const { score, valid } = farkleScore(vals);
    const s = $("#farkle-selection");
    s.classList.toggle("is-invalid", vals.length > 0 && !valid);
    if (F.bust) {
      s.innerHTML = `<i class="fa-solid fa-skull"></i> <b>Пусто!</b> За ход сгорает ${F.bustLost}`;
    } else if (!vals.length) {
      s.innerHTML = "Выберите кости, которые дают очки";
    } else if (!valid) {
      s.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Эти кости вместе очков не дают';
    } else {
      s.innerHTML = `Выбрано на <b>${score}</b>`;
    }
    const left = F.rolled.length - vals.length;
    const n = left === 0 ? 6 : left;
    $("#farkle-roll [data-roll-label]").textContent = left === 0 ? "Отложить и бросить все 6" : `Отложить и бросить ${n}`;
    $("#farkle-bank [data-bank]").textContent = F.turn + (valid ? score : 0);
    $("#farkle-roll").disabled = !valid || F.busy || F.bust;
    $("#farkle-bank").disabled = !valid || F.busy || F.bust;
  }

  $("#farkle-dice").addEventListener("click", (e) => {
    const d = e.target.closest(".tg-die");
    if (!d || F.busy || F.bust) return;
    const i = Number(d.dataset.i);
    F.sel.has(i) ? F.sel.delete(i) : F.sel.add(i);
    d.classList.toggle("is-selected");
    farkleUpdateSelection();
  });

  function farkleTurnTo(who) {
    $("#seat-mira").classList.toggle("is-turn", who === "mira");
    $("#seat-martin").classList.toggle("is-turn", who === "martin");
    $("#seat-martin .tg-thinking").hidden = who !== "martin";
  }

  async function farkleBotTurn() {
    F.busy = true;
    farkleTurnTo("martin");
    farkleUpdateSelection();
    await wait(1700);
    const gain = [250, 300, 350, 400][rnd(4) - 1];
    F.martin += gain;
    const sc = $("#seat-martin [data-score]");
    sc.firstChild.textContent = F.martin;
    $("#seat-martin .tg-progress i").style.setProperty("--p", Math.min(F.martin / 2000, 1));
    pop(sc, `+${gain}`);
    logLine($("#farkle-log"), $("#farkle-last"), `<b>Старый Мартин</b> записывает ${gain} — всего ${F.martin}`);
    await wait(700);
    farkleTurnTo("mira");
    F.busy = false;
    F.bust = false;
    F.tray = [];
    F.turn = 0;
    F.sel = new Set();
    F.rolled = Array.from({ length: 6 }, () => rnd(6));
    await farkleRender({ animate: true });
    farkleUpdateSelection();
  }

  $("#farkle-roll").addEventListener("click", async () => {
    const vals = [...F.sel].map((i) => F.rolled[i]);
    const { score, valid } = farkleScore(vals);
    if (!valid) return;
    F.turn += score;
    F.tray.push(...vals);
    let left = F.rolled.length - vals.length;
    if (left === 0) { left = 6; F.tray = []; }
    logLine($("#farkle-log"), $("#farkle-last"), `<b>Мира</b> откладывает ${vals.map((v) => `<span class="tg-die" data-face="${v}"></span>`).join("")} — ${score}`);
    F.sel = new Set();
    F.rolled = Array.from({ length: left }, () => rnd(6));
    F.busy = true;
    await farkleRender({ animate: true });
    F.busy = false;
    if (!farkleHasScore(F.rolled)) {
      F.bust = true;
      F.bustLost = F.turn;
      farkleRender();
      logLine($("#farkle-log"), $("#farkle-last"), `<b>Мира</b>: пусто, ${F.bustLost} сгорает`);
      await wait(1400);
      farkleBotTurn();
    } else {
      farkleUpdateSelection();
    }
  });

  $("#farkle-bank").addEventListener("click", () => {
    const vals = [...F.sel].map((i) => F.rolled[i]);
    const { score, valid } = farkleScore(vals);
    if (!valid) return;
    const total = F.turn + score;
    F.me += total;
    const sc = $("#mira-score");
    sc.firstChild.textContent = F.me;
    $("#mira-progress").style.setProperty("--p", Math.min(F.me / 2000, 1));
    pop(sc, `+${total}`);
    logLine($("#farkle-log"), $("#farkle-last"), `<b>Мира</b> записывает ${total} — всего ${F.me}`);
    F.sel = new Set();
    F.tray = [];
    F.turn = 0;
    farkleRender();
    farkleBotTurn();
  });

  /* =========================================================
     КОСТИ ЛЖЕЦА
     ========================================================= */

  const FACE_NOM = ["", "единица", "двойка", "тройка", "четвёрка", "пятёрка", "шестёрка"];
  const FACE_NOM_PL = ["", "единицы", "двойки", "тройки", "четвёрки", "пятёрки", "шестёрки"];
  const FACE_GEN_PL = ["", "единиц", "двоек", "троек", "четвёрок", "пятёрок", "шестёрок"];
  const NUM_F = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять", "десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать"];
  const bidText = (q, f) => {
    const noun = plural(q, FACE_NOM[f], FACE_NOM_PL[f], FACE_GEN_PL[f]);
    const t = `${NUM_F[q] ?? q} ${noun}`;
    return t[0].toUpperCase() + t.slice(1);
  };

  const L = { mine: [2, 5, 5, 1, 6], cur: { q: 4, f: 5 }, q: 5, f: 5 };

  function liarsRender() {
    const mine = $("#liars-mine");
    mine.innerHTML = "";
    L.mine.forEach((f) => mine.append(makeDie(f, { cls: "tg-die--sm" })));
    const faces = $("#liars-faces");
    faces.innerHTML = "";
    for (let f = 1; f <= 6; f++) {
      const d = makeDie(f, { tag: "button" });
      d.dataset.f = f;
      d.setAttribute("aria-pressed", String(f === L.f));
      d.setAttribute("aria-label", FACE_NOM_PL[f]);
      faces.append(d);
    }
    liarsUpdate();
  }

  function liarsUpdate() {
    $("#liars-q").textContent = L.q;
    $$("#liars-faces .tg-die").forEach((d) => d.setAttribute("aria-pressed", String(Number(d.dataset.f) === L.f)));
    const ok = L.q > L.cur.q || (L.q === L.cur.q && L.f > L.cur.f);
    $("#liars-bid span").textContent = bidText(L.q, L.f);
    $("#liars-bid").disabled = !ok;
    const cap = $("#liars-caption");
    cap.textContent = `Ваша ставка — выше, чем «${bidText(L.cur.q, L.cur.f).toLowerCase()}»`;
    cap.classList.toggle("is-invalid", !ok);
  }

  $("#liars").addEventListener("click", (e) => {
    const step = e.target.closest("[data-q]");
    if (step) { L.q = Math.max(1, Math.min(17, L.q + Number(step.dataset.q))); liarsUpdate(); return; }
    const face = e.target.closest("#liars-faces .tg-die");
    if (face) { L.f = Number(face.dataset.f); liarsUpdate(); return; }
    if (e.target.closest("#liars-bid")) {
      L.cur = { q: L.q, f: L.f };
      const bubble = $(".tg-cupseat.is-turn .tg-bid-bubble");
      $(".tg-liars__center .tg-felt__label").textContent = "Ваша ставка";
      $(".tg-liars__bid").innerHTML = `${L.q} × <span class="tg-die" data-face="${L.f}"></span>`;
      pipify($(".tg-liars__bid .tg-die"));
      bubble?.classList.add("tg-bid-bubble--old");
      liarsUpdate();
      return;
    }
    if (e.target.closest("#liars-call") || e.target.closest("#liars-spot")) {
      liarsReveal(Boolean(e.target.closest("#liars-spot")));
      return;
    }
    if (e.target.closest("#liars-again")) {
      $("#liars").classList.remove("is-reveal");
      $("#liars-again").hidden = true;
      L.mine = Array.from({ length: 5 }, () => rnd(6));
      L.cur = { q: 4, f: 5 };
      L.q = 5; L.f = 5;
      $(".tg-liars__center .tg-felt__label").textContent = "Ставка Бренны";
      $(".tg-liars__bid").innerHTML = `4 × <span class="tg-die" data-face="5"></span>`;
      pipify($(".tg-liars__bid .tg-die"));
      liarsRender();
      $$("#liars-mine .tg-die").forEach((d, i) => rollDie(d, L.mine[i], i * 50));
    }
  });

  function liarsReveal(spot) {
    const f = L.cur.f;
    const match = (v) => v === f || v === 1;
    let count = 0;
    $$("#liars .tg-reveal-dice").forEach((box) => {
      box.innerHTML = "";
      box.dataset.reveal.split(",").map(Number).forEach((v) => {
        const d = makeDie(v);
        if (match(v)) { d.classList.add("is-match"); count++; }
        box.append(d);
      });
    });
    $$("#liars-mine .tg-die").forEach((d, i) => {
      const v = L.mine[i];
      d.classList.toggle("is-match", match(v));
      if (match(v)) count++;
    });
    const holds = spot ? count === L.cur.q : count >= L.cur.q;
    const noun = plural(count, FACE_NOM[f], FACE_NOM_PL[f], FACE_GEN_PL[f]);
    const verdict = spot
      ? (holds ? "В точку! Каждый, кроме вас, теряет кость." : "Мимо — Мира теряет кость.")
      : (holds ? "Ставка честная — Мира теряет кость." : "Блеф раскрыт — Бренна теряет кость.");
    $("#liars-verdict").innerHTML = `<i class="fa-solid ${holds === spot ? "fa-circle-check" : "fa-circle-xmark"}"></i> На столе ${count} ${noun} (с единицами). ${verdict}`;
    $("#liars").classList.add("is-reveal");
    $("#liars-again").hidden = false;
  }

  /* =========================================================
     КНАКЛБОУНС
     ========================================================= */

  const K = { opp: [[3, 3], [5], []], me: [[4], [2, 6], []], die: 3, turn: "me", busy: false };

  const colScore = (col) => {
    const c = {};
    col.forEach((v) => (c[v] = (c[v] ?? 0) + 1));
    return Object.entries(c).reduce((s, [v, n]) => s + Number(v) * n * n, 0);
  };
  const colMult = (col) => Math.max(1, ...Object.values(col.reduce((c, v) => ((c[v] = (c[v] ?? 0) + 1), c), {})));
  const total = (b) => b.reduce((s, col) => s + colScore(col), 0);
  const full = (b) => b.every((col) => col.length === 3);

  function kbBoard(el, board, interactive) {
    el.innerHTML = "";
    board.forEach((col, ci) => {
      const c = document.createElement(interactive ? "button" : "div");
      c.className = "tg-kb__col";
      c.dataset.col = ci;
      if (interactive) {
        c.type = "button";
        c.disabled = col.length >= 3 || K.turn !== "me" || K.busy;
        c.setAttribute("aria-label", `Колонка ${ci + 1}`);
      }
      const counts = col.reduce((m, v) => ((m[v] = (m[v] ?? 0) + 1), m), {});
      for (let r = 0; r < 3; r++) {
        const well = document.createElement("span");
        well.className = "tg-well";
        if (col[r] != null) {
          const d = makeDie(col[r]);
          if (counts[col[r]] === 2) d.classList.add("m2");
          if (counts[col[r]] >= 3) d.classList.add("m3");
          well.append(d);
        }
        c.append(well);
      }
      el.append(c);
    });
  }

  function kbScores(el, board) {
    el.innerHTML = board
      .map((col) => {
        const m = colMult(col);
        return `<span>${colScore(col)}${m > 1 ? `<small class="${m >= 3 ? "x3" : ""}">×${m}</small>` : ""}</span>`;
      })
      .join("");
  }

  function kbRender() {
    kbBoard($("#kb-opp"), K.opp, false);
    kbBoard($("#kb-me"), K.me, true);
    kbScores($("#kb-opp-scores"), K.opp);
    kbScores($("#kb-me-scores"), K.me);
    $("#kb-opp-total").textContent = total(K.opp);
    $("#kb-me-total").textContent = total(K.me);
    setFace($("#kb-die"), K.die);
  }

  function kbPreview(ci, on) {
    const col = $$(`#kb-me .tg-kb__col`)[ci];
    $$(".tg-die.is-ghost", col).forEach((d) => d.remove());
    $$("#kb-opp .tg-die.is-threat").forEach((d) => d.classList.remove("is-threat"));
    if (!on || K.turn !== "me" || K.busy || K.me[ci].length >= 3) return;
    const well = $$(".tg-well", col)[K.me[ci].length];
    well.append(makeDie(K.die, { cls: "is-ghost" }));
    $$(".tg-die", $$("#kb-opp .tg-kb__col")[ci]).forEach((d) => {
      if (Number(d.dataset.face) === K.die) d.classList.add("is-threat");
    });
  }

  $("#kb-me").addEventListener("mouseover", (e) => {
    const c = e.target.closest(".tg-kb__col");
    if (c) kbPreview(Number(c.dataset.col), true);
  });
  $("#kb-me").addEventListener("mouseout", (e) => {
    const c = e.target.closest(".tg-kb__col");
    if (c && !c.contains(e.relatedTarget)) kbPreview(Number(c.dataset.col), false);
  });

  async function kbPlace(side, ci) {
    const mine = side === "me";
    const own = mine ? K.me : K.opp;
    const other = mine ? K.opp : K.me;
    const v = K.die;
    own[ci].push(v);
    kbRender();
    const ownCol = $$(`${mine ? "#kb-me" : "#kb-opp"} .tg-kb__col`)[ci];
    const placed = $$(".tg-well", ownCol)[own[ci].length - 1].firstElementChild;
    if (placed && motionOn()) placed.classList.add("is-landed");
    const hits = other[ci].filter((x) => x === v).length;
    if (hits) {
      const otherCol = $$(`${mine ? "#kb-opp" : "#kb-me"} .tg-kb__col`)[ci];
      $$(".tg-die", otherCol).forEach((d) => {
        if (Number(d.dataset.face) === v) {
          d.style.setProperty("--kx", `${(Math.random() * 80 + 30) * (Math.random() < 0.5 ? -1 : 1)}px`);
          d.classList.add("is-knocked");
        }
      });
      await wait(motionOn() ? 560 : 0);
      other[ci] = other[ci].filter((x) => x !== v);
    }
    const before = Number($(mine ? "#kb-me-total" : "#kb-opp-total").textContent);
    kbRender();
    const after = total(own);
    if (after > before - 1) pop($(mine ? "#kb-me-total" : "#kb-opp-total"), `+${after - before + (hits ? 0 : 0)}`);
    const name = mine ? "Мира" : "Хейл";
    logLine(null, $("#kb-last"), `<b>${name}</b> кладёт <span class="tg-die" data-face="${v}"></span> в ${["первую", "вторую", "третью"][ci]} колонку${hits ? ` и сбивает ${hits}` : ""}`);
    pipify($("#kb-last .tg-die"));
  }

  function kbEnd() {
    if (!full(K.me) && !full(K.opp)) return false;
    const a = total(K.me), b = total(K.opp);
    $("#kb-divider").textContent = a === b ? `ничья ${a} : ${b}` : a > b ? `Мира побеждает ${a} : ${b}` : `Хейл побеждает ${b} : ${a}`;
    $("#kb-plate-label").textContent = "ещё раз?";
    K.turn = "end";
    kbRender();
    return true;
  }

  $("#kb-me").addEventListener("click", async (e) => {
    const c = e.target.closest(".tg-kb__col");
    if (!c || c.disabled || K.turn !== "me" || K.busy) return;
    K.busy = true;
    await kbPlace("me", Number(c.dataset.col));
    if (kbEnd()) { K.busy = false; return; }
    // ход бота
    K.turn = "opp";
    $("#kb-divider").textContent = "ход Хейла";
    $("#kb-plate-label").textContent = "кубик Хейла";
    $("#kb-thinking").hidden = false;
    kbRender();
    K.die = rnd(6);
    await rollDie($("#kb-die"), K.die);
    await wait(650);
    let best = -1, bestGain = -Infinity;
    K.opp.forEach((col, ci) => {
      if (col.length >= 3) return;
      const gain = colScore([...col, K.die]) - colScore(col) + (colScore(K.me[ci]) - colScore(K.me[ci].filter((x) => x !== K.die))) + Math.random();
      if (gain > bestGain) { bestGain = gain; best = ci; }
    });
    $("#kb-thinking").hidden = true;
    await kbPlace("opp", best);
    if (kbEnd()) { K.busy = false; return; }
    K.turn = "me";
    $("#kb-divider").textContent = "ваш ход";
    $("#kb-plate-label").textContent = "ваш кубик";
    K.die = rnd(6);
    K.busy = false;
    kbRender();
    await rollDie($("#kb-die"), K.die);
  });

  $(".tg-kb__plate").addEventListener("click", () => {
    if (K.turn !== "end") return;
    K.opp = [[], [], []];
    K.me = [[], [], []];
    K.turn = "me";
    K.die = rnd(6);
    $("#kb-divider").textContent = "ваш ход";
    $("#kb-plate-label").textContent = "ваш кубик";
    kbRender();
    rollDie($("#kb-die"), K.die);
  });

  /* =========================================================
     ПОКЕР НА КОСТЯХ
     ========================================================= */

  const HANDS = ["Ничего", "Пара", "Две пары", "Тройка", "Малый стрит", "Большой стрит", "Фулл-хаус", "Каре", "Покер"];
  function pokerRank(vals) {
    const c = [0, 0, 0, 0, 0, 0, 0];
    vals.forEach((v) => c[v]++);
    const counts = c.slice(1).filter(Boolean).sort((a, b) => b - a).join("");
    if (counts === "5") return 8;
    if (counts === "41") return 7;
    if (counts === "32") return 6;
    const s = [...vals].sort().join("");
    if (s === "23456") return 5;
    if (s === "12345") return 4;
    if (counts === "311") return 3;
    if (counts === "221") return 2;
    if (counts === "2111") return 1;
    return 0;
  }

  const PK = { dice: [4, 4, 2, 4, 6], sel: new Set([2, 4]), phase: "reroll", score: [1, 0] };

  function pokerRender() {
    const box = $("#poker-dice");
    box.innerHTML = "";
    const els = PK.dice.map((f, i) => {
      const d = makeDie(f, { tag: PK.phase === "reroll" ? "button" : "span", cls: "tg-die--lg" });
      d.dataset.i = i;
      scatter(d);
      if (PK.phase === "reroll" && PK.sel.has(i)) d.classList.add("is-reroll");
      box.append(d);
      return d;
    });
    const r = pokerRank(PK.dice);
    $("#poker-hand").innerHTML = `${HANDS[r]}<small>ваша рука</small>`;
    $("#poker-ladder").innerHTML = HANDS.map((h, i) => `<span class="${i === r ? "on" : ""}">${h}</span>`).join("");
    const btn = $("#poker-reroll span");
    if (btn) btn.textContent = `Перебросить ${PK.sel.size}`;
    if ($("#poker-reroll")) $("#poker-reroll").disabled = PK.sel.size === 0;
    return els;
  }

  function pokerActions(html, text) {
    $("#poker-bettext").innerHTML = text;
    $("#poker-actions").innerHTML = html;
  }

  $("#poker-dice").addEventListener("click", (e) => {
    const d = e.target.closest("button.tg-die");
    if (!d || PK.phase !== "reroll") return;
    const i = Number(d.dataset.i);
    PK.sel.has(i) ? PK.sel.delete(i) : PK.sel.add(i);
    d.classList.toggle("is-reroll");
    pokerRender();
  });

  $("#poker-betline").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.id === "poker-reroll" || b.id === "poker-keep") {
      const which = b.id === "poker-reroll" ? [...PK.sel] : [];
      which.forEach((i) => (PK.dice[i] = rnd(6)));
      PK.phase = "bet";
      PK.sel = new Set();
      const els = pokerRender();
      await Promise.all(which.map((i, k) => rollDie(els[i], PK.dice[i], k * 60)));
      pokerActions(
        `<button type="button" class="tg-btn tg-btn--danger" data-bet="fold"><i class="fa-solid fa-flag"></i> Пас</button>
         <button type="button" class="tg-btn" data-bet="raise"><i class="fa-solid fa-arrow-up"></i> Повысить +5</button>
         <button type="button" class="tg-btn tg-btn--primary" data-bet="call"><i class="fa-solid fa-coins"></i> Уравнять 5</button>`,
        `<b>Бренна</b> повышает до <b>20 зм</b>. Ваш ответ?`,
      );
      return;
    }
    if (b.dataset.bet) {
      const mine = pokerRank(PK.dice);
      const theirs = 2;
      let text;
      if (b.dataset.bet === "fold") text = "Вы пасуете — рука уходит Бренне.";
      else if (mine > theirs) { PK.score[0]++; text = `Вскрытие: у вас <b>${HANDS[mine]}</b> против двух пар. Рука ваша! Счёт ${PK.score[0]} : ${PK.score[1]}.`; }
      else if (mine < theirs) { PK.score[1]++; text = `Вскрытие: у Бренны две пары против вашей руки «${HANDS[mine]}». Счёт ${PK.score[0]} : ${PK.score[1]}.`; }
      else text = "Вскрытие: равные руки — решают старшие кости.";
      bump($("#poker-pot"));
      pokerActions(`<button type="button" class="tg-btn tg-btn--primary" data-bet="next"><i class="fa-solid fa-rotate"></i> Следующая рука</button>`, text);
      if (b.dataset.bet === "next") {
        PK.dice = Array.from({ length: 5 }, () => rnd(6));
        PK.phase = "reroll";
        PK.sel = new Set();
        const els = pokerRender();
        els.forEach((d, i) => rollDie(d, PK.dice[i], i * 50));
        pokerActions(
          `<button type="button" class="tg-btn" id="poker-keep">Оставить как есть</button>
           <button type="button" class="tg-btn tg-btn--primary" id="poker-reroll" disabled><i class="fa-solid fa-rotate-right"></i> <span>Перебросить 0</span></button>`,
          "Ставки уравнены: <b>по 15 зм</b>. Выберите кости для переброса — или оставьте руку как есть.",
        );
      }
    }
  });

  /* =========================================================
     ДВАДЦАТЬ ОДНО
     ========================================================= */

  const T = { rolled: [["d6", 4], ["d10", 7]], spent: new Set(["d6", "d10"]), done: false, wins: 1 };
  const twTotal = () => T.rolled.reduce((s, [, v]) => s + v, 0);

  function twRender() {
    const r = $("#tw-rolled");
    r.innerHTML = "";
    T.rolled.forEach(([k, v]) => r.append(makePoly(k, v, { tag: "span", cap: false })));
    const pool = $("#tw-pool");
    pool.innerHTML = "";
    Object.keys(SIDES).forEach((k) => {
      const p = makePoly(k, "?");
      p.dataset.kind = k;
      if (T.spent.has(k)) { p.classList.add("is-spent"); p.disabled = true; $(".tg-poly__num", p).textContent = ""; }
      if (T.done) p.disabled = true;
      pool.append(p);
    });
    twTotals();
  }

  function twTotals() {
    const t = twTotal();
    const bust = t > 21;
    $("#tw-total").innerHTML = `${t} <small>/ 21</small>`;
    $("#tw-track").classList.toggle("is-bust", bust);
    $("#tw-track i").style.setProperty("--p", Math.min(t / 21, 1));
    return { t, bust };
  }

  $("#tw-pool").addEventListener("click", async (e) => {
    const p = e.target.closest(".tg-poly");
    if (!p || p.disabled || T.done) return;
    const k = p.dataset.kind;
    const v = rnd(SIDES[k]);
    T.spent.add(k);
    $$("#tw-pool .tg-poly").forEach((x) => (x.disabled = true));
    await rollPoly(p, SIDES[k], v);
    T.rolled.push([k, v]);
    twRender();
    const { t, bust } = twTotals();
    pop($("#tw-total"), `+${v}`);
    if (bust) {
      T.done = true;
      twRender();
      $("#tw-status").innerHTML = `<span class="tg-bust-stamp"><i class="fa-solid fa-xmark"></i> перебор</span> ${t} — раунд проигран`;
      $("#tw-stand").innerHTML = '<i class="fa-solid fa-rotate"></i> Следующий раунд';
    } else {
      $("#tw-status").textContent = `Сумма ${t}. Ещё кубик или хватит?`;
    }
  });

  $("#tw-stand").addEventListener("click", () => {
    if (T.done) {
      T.rolled = [];
      T.spent = new Set();
      T.done = false;
      $("#tw-status").textContent = "Новый раунд: бросайте первый кубик";
      $("#tw-stand").innerHTML = '<i class="fa-solid fa-hand"></i> Хватит';
      twRender();
      return;
    }
    const t = twTotal();
    T.done = true;
    const res = t > 18 ? "Раунд ваш!" : t === 18 ? "Ничья с Брамом" : "Раунд за Брамом";
    $("#tw-status").textContent = `Вы остановились на ${t}. ${res}`;
    $("#tw-stand").innerHTML = '<i class="fa-solid fa-rotate"></i> Следующий раунд';
    twRender();
  });

  $$(".tg-21__opp-dice").forEach((el) => {
    el.dataset.mini.split(",").forEach((pair) => {
      const [k, v] = pair.split(":");
      el.append(makePoly(k, v, { tag: "span", sm: true, cap: false }));
    });
  });

  /* =========================================================
     КОРАБЛЬ, КАПИТАН И КОМАНДА
     ========================================================= */

  const S = { rolls: 1, slots: { 6: true, 5: true, 4: false }, free: [2, 3, 1], cargo: null, done: false };
  const sccNeed = () => (!S.slots[6] ? 6 : !S.slots[5] ? 5 : !S.slots[4] ? 4 : null);

  function sccRender() {
    $("#scc-rolls").innerHTML = `броски <span class="tg-pips">${[0, 1, 2].map((i) => `<i class="${i < S.rolls ? "on" : ""}"></i>`).join("")}</span>`;
    $$(".tg-slot").forEach((slot) => {
      const v = Number(slot.dataset.slot);
      const well = $(".tg-well", slot);
      $(".tg-die", well)?.remove();
      slot.classList.toggle("is-filled", S.slots[v]);
      $(".tg-slot__need", slot).hidden = S.slots[v];
      if (S.slots[v]) well.append(makeDie(v));
    });
    const free = $("#scc-free");
    free.innerHTML = "";
    const cargoBox = $("#scc-cargo-dice");
    cargoBox.innerHTML = "";
    const need = sccNeed();
    if (need) S.free.forEach((f) => { const d = makeDie(f); scatter(d); free.append(d); });
    else S.free.forEach((f) => cargoBox.append(makeDie(f, { cls: "tg-die--sm" })));
    $("#scc-cargo").classList.toggle("is-locked", Boolean(need));
    $("#scc-cargo-sum").textContent = need ? "—" : S.free.reduce((a, b) => a + b, 0);
    const names = { 6: "шестёрку — корабль", 5: "пятёрку — капитана", 4: "четвёрку — команду" };
    const left = 3 - S.rolls;
    if (S.done) {
      $("#scc-need").textContent = need ? "бросков не осталось — без корабля" : `итог: груз ${S.free.reduce((a, b) => a + b, 0)}`;
    } else {
      $("#scc-need").textContent = need ? `ищем ${names[need]}` : `команда в сборе · бросков осталось: ${left}`;
    }
    const rollBtn = $("#scc-roll");
    const stopBtn = $("#scc-stop");
    if (S.done) {
      rollBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> <span>Новая партия</span>';
      rollBtn.disabled = false;
      stopBtn.disabled = true;
    } else {
      rollBtn.innerHTML = `<i class="fa-solid fa-dice"></i> <span>${need ? `Бросить ${S.free.length} ${plural(S.free.length, "кость", "кости", "костей")}` : "Перебросить груз"}</span>`;
      rollBtn.disabled = left <= 0;
      stopBtn.disabled = Boolean(need);
      stopBtn.innerHTML = `<i class="fa-solid fa-box"></i> <span>${need ? "Оставить груз" : `Оставить груз ${S.free.reduce((a, b) => a + b, 0)}`}</span>`;
    }
  }

  $("#scc-roll").addEventListener("click", async () => {
    if (S.done) {
      Object.assign(S, { rolls: 0, slots: { 6: false, 5: false, 4: false }, free: [1, 1, 1, 1, 1], done: false });
      sccRender();
      return;
    }
    S.rolls++;
    S.free = S.free.map(() => rnd(6));
    const needBefore = sccNeed();
    // сначала показываем бросок
    const tmp = { ...S };
    sccRender();
    const box = needBefore ? $("#scc-free") : $("#scc-cargo-dice");
    await Promise.all($$(".tg-die", box).map((d, i) => rollDie(d, S.free[i], i * 50)));
    await wait(motionOn() ? 250 : 0);
    // затем найденное встаёт в гнёзда по порядку
    for (const v of [6, 5, 4]) {
      if (S.slots[v]) continue;
      const prevOk = v === 6 || S.slots[v + 1];
      const idx = S.free.indexOf(v);
      if (prevOk && idx >= 0) { S.slots[v] = true; S.free.splice(idx, 1); }
    }
    if (S.rolls >= 3) S.done = true;
    void tmp;
    sccRender();
    const cargo = S.free.reduce((a, b) => a + b, 0);
    if (!sccNeed() && !needBefore) pop($("#scc-cargo-sum"), `${cargo}`);
  });

  $("#scc-stop").addEventListener("click", () => {
    S.done = true;
    sccRender();
  });

  /* ---------------- старт ---------------- */

  $$(".tg-die").forEach(pipify);
  renderLobby("farkle");
  renderSeating();
  farkleRender();
  liarsRender();
  kbRender();
  pokerRender();
  twRender();
  sccRender();

  const params = new URLSearchParams(location.search);
  const saved = params.get("theme") ?? store.get("tg-mock-theme");
  setTheme(saved === "parchment" ? "parchment" : "tavern");
  setMotion(params.get("motion") !== "off");

  // ?solo=<id> — только одно окно, для снимков
  const solo = params.get("solo");
  if (solo) {
    document.body.classList.add("solo");
    $$(".board > section").forEach((s) => (s.hidden = s.id !== solo));
    $$(".board-note").forEach((n) => (n.hidden = true));
    $(".board-bar").hidden = true;
  }
})();
