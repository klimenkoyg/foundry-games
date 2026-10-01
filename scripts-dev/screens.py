#!/usr/bin/env python3
"""Снимки окон модуля для README: docs/screens/<язык>/<имя>.webp.

Окна берутся со стенда (dev/harness) в безголовом Chrome, фон прозрачный, снимок обрезается по окну.
Нужны: сервер стенда (python3 -m http.server 8765 --bind 127.0.0.1 из корня), Google Chrome, Pillow.

    python3 scripts-dev/screens.py            # все снимки, оба языка
    python3 scripts-dev/screens.py kb liars   # только названные
    python3 scripts-dev/screens.py --lang en farkle
"""

import pathlib
import subprocess
import sys
import tempfile
import urllib.parse

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "screens"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BASE = "http://localhost:8765/dev/harness/index.html?bare=1"
LANGS = {"ru": "Трактир «Сломанное колесо»", "en": "The Broken Wheel"}

# Общее начало сценария: помощники. tavern = window.__tavern со стенда.
PRELUDE = """
const api = game.modules.get('ssl_tavern_games').api;
const H = tavern.Host, wait = tavern.wait, seat = tavern.seat;
const T = () => tavern.table();
const cur = () => T().view.current;
const mine = (i) => T().seats[i].id;
const win = () => tavern.win();
const until = async (fn, ms = 60000) => { const t = performance.now(); while (!fn()) { if (performance.now() - t > ms) throw new Error('не дождались: ' + fn); await wait(100); } };
/* Ход за место ведущего так, как сходил бы бот, пока ход не уйдёт дальше. */
const auto = async () => { const id = T().id, me = cur(); for (let n = 0; n < 14 && T().status === 'playing' && cur() === me; n++) { await H.autoMove(id); await wait(150); } };
const click = async (sel, ms = 500) => { win().querySelector(sel).click(); await wait(ms); };
let shown = null;
const show = (el) => { shown = el; };
"""

# Общий конец: прозрачный фон, без анимаций, окно в угол, остальные окна убрать.
FINALE = """
H.clearTimers();
await wait(300);
document.head.insertAdjacentHTML('beforeend', '<style>*{animation:none!important;transition:none!important} html,body{background:transparent!important}</style>');
const target = shown ?? win();
for (const el of document.querySelectorAll('.application')) if (el !== target) el.remove();
Object.assign(target.style, { left: '48px', top: '40px' });
await wait(200);
"""

SCENES = {
    "lobby": dict(size=(900, 1000), js="""
        await tavern.make('liars', [seat('ilva', 'bot', 'counter'), seat('hale', 'bot', 'reckless'), seat('bram', 'bot')], { stake: 5, title: TITLE });
        H.clearTimers();
        await foundry.applications.instances.get(win().id).close();
        api.openLobby(); await wait(900);
        document.querySelector('#tavern-lobby [data-game=farkle]')?.click(); await wait(500);
        show(document.querySelector('#tavern-lobby'));
    """),
    "seating": dict(size=(960, 1000), js="""
        api.openSeating('liars'); await wait(900);
        const el = () => document.querySelector('.tg-seating-app');
        el().querySelector('[data-action=addUser]').click(); await wait(300);
        el().querySelector('[data-action=addUser]').click(); await wait(300);
        el().querySelector('[data-action=takeSelected]').click(); await wait(300);
        const gm = el().querySelectorAll('.tg-seatrow [data-action=setControl][data-value=gm]');
        gm[gm.length - 1].click(); await wait(300);
        const temper = el().querySelector('.tg-seatrow select'); temper.value = 'reckless';
        temper.dispatchEvent(new Event('change', { bubbles: true })); await wait(200);
        const stake = el().querySelector('[name="stake.amount"]'); stake.value = '5';
        stake.dispatchEvent(new Event('change', { bubbles: true })); await wait(400);
        show(el());
    """),
    "farkle": dict(size=(780, 900), js="""
        await tavern.make('farkle', [seat('hale', 'bot', 'reckless'), seat('bram', 'bot', 'counter'), seat('mira', 'gm'), seat('ilva', 'bot')], { stake: 5, title: TITLE, options: { target: 3000 } });
        const me = mine(2);
        let turns = 0;
        for (;;) {
          await until(() => cur() === me && !T().preview);
          if (turns++ < 2) { await auto(); continue; }
          await click('[data-op=roll]', 700);
          if (cur() === me && T().view.turn.dice.length) break;   // иначе «пусто» — ждём следующего круга
        }
        const dice = T().view.turn.dice;
        const triple = [1, 2, 3, 4, 5, 6].find((f) => dice.filter((v) => v === f).length >= 3);
        for (let i = 0, t = 0; i < dice.length; i++) {
          const take = dice[i] === 1 || dice[i] === 5 || (dice[i] === triple && t++ < 3);
          if (take) await click(`.tg-dice button.tg-die[data-arg="${i}"]`, 150);
        }
    """),
    "liars": dict(size=(780, 900), js="""
        await tavern.make('liars', [seat('hale', 'bot', 'reckless'), seat('bram', 'bot', 'counter'), seat('ilva', 'bot'), seat('mira', 'gm')], { stake: 5, title: TITLE });
        const me = mine(3);
        for (;;) {
          await until(() => cur() === me && T().view.phase === 'bidding');
          if (T().view.round >= 2 && T().view.bid) break;
          await auto();
        }
    """),
    "kb": dict(size=(780, 860), theme="parchment", js="""
        await tavern.make('kb', [seat('mira', 'gm'), seat('hale', 'bot', 'counter')], { stake: 5, theme: 'parchment', title: TITLE });
        const me = mine(0);
        for (;;) {
          await until(() => cur() === me);
          if (T().view.turnCount >= 10) break;
          await auto();
        }
        await click('[data-op=roll]', 900);
        win().querySelector('button.tg-kb__col:not(:disabled)')?.dispatchEvent(new MouseEvent('mouseenter'));
    """),
    "poker": dict(size=(780, 900), theme="parchment", js="""
        await tavern.make('poker', [seat('hale', 'bot', 'reckless'), seat('mira', 'gm'), seat('bram', 'bot', 'counter')], { stake: 5, theme: 'parchment', title: TITLE, options: { handsToWin: 3 } });
        const me = mine(1);
        for (;;) {
          await until(() => cur() === me);
          if (T().view.handNo >= 2 && T().view.phase !== 'bet1') break;
          await auto();
        }
    """),
    "tw": dict(size=(780, 900), js="""
        await tavern.make('tw', [seat('hale', 'bot', 'reckless'), seat('mira', 'gm'), seat('bram', 'bot', 'counter')], { stake: 5, title: TITLE });
        const me = mine(1);
        for (;;) {
          await until(() => cur() === me);
          if (T().view.round >= 2 && T().view.hands[mine(0)].rolled.length) break;
          await auto();
        }
        const used = T().view.hands[me].rolled.map((r) => r.sides);
        for (const sides of [6, 4, 8]) {
          if (used.includes(sides) || T().view.hands[me].total + sides > T().view.rules.limit) continue;
          await click(`[data-op=take][data-arg="${sides}"]`, 500);
          if (T().view.took >= 2) break;
        }
    """),
    "scc": dict(size=(780, 900), theme="parchment", js="""
        await tavern.make('scc', [seat('hale', 'bot', 'reckless'), seat('bram', 'bot', 'counter'), seat('mira', 'gm')], { stake: 5, theme: 'parchment', title: TITLE });
        const me = mine(2);
        await until(() => cur() === me);
        await click('[data-op=roll]', 700);
        if (cur() === me && !T().view.hands[me].crew && T().view.maxRolls - T().view.hands[me].rolls > 1) await click('[data-op=roll]', 700);
    """),
    "rules": dict(size=(640, 1040), js="""
        api.openRules('farkle'); await wait(800);
        show(document.querySelector('[id^=tavern-rules]'));
    """),
}


def shoot(name, lang, tries=4):
    """Кости случайные: партия может кончиться раньше нужного момента — тогда снимаем заново."""
    scene = SCENES[name]
    width, height = scene["size"]
    js = f"const TITLE = {LANGS[lang]!r};\n{PRELUDE}\n{scene['js']}\n{FINALE}"
    url = f"{BASE}&lang={lang}&do={urllib.parse.quote(js)}"
    with tempfile.TemporaryDirectory() as tmp:
        raw = pathlib.Path(tmp) / "shot.png"
        subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
             f"--window-size={width},{height}", "--default-background-color=00000000",
             "--virtual-time-budget=180000", f"--screenshot={raw}", url],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=300,
        )
        image = Image.open(raw).convert("RGBA")
    box = image.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    if not box or (box[2] - box[0] == image.width and box[3] - box[1] == image.height):
        # фон не стал прозрачным — сценарий не дошёл до конца
        if tries > 1:
            print(f"… {name}/{lang}: сценарий не дошёл до нужного момента, ещё раз")
            return shoot(name, lang, tries - 1)
        raise SystemExit(f"{name}/{lang}: не удалось снять окно")
    image = image.crop(box)
    target = OUT / lang / f"{name}.webp"
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, "WEBP", quality=86, method=6)
    print(f"✓ {target.relative_to(ROOT)}  {image.width}×{image.height}  {target.stat().st_size // 1024} КБ")


if __name__ == "__main__":
    args = sys.argv[1:]
    langs = list(LANGS)
    if args[:1] == ["--lang"]:
        langs, args = [args[1]], args[2:]
    for lang in langs:
        for name in args or list(SCENES):
            shoot(name, lang)
