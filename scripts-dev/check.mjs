/* Проверки без Foundry: синтаксис всех модулей, наличие ключей перевода, шаблонов и файлов манифеста. */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/%20/g, " ");
const walk = (dir, ext) =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) return walk(rel, ext);
    return ext.some((e) => name.endsWith(e)) ? [rel] : [];
  });

let problems = 0;
const fail = (msg) => {
  problems++;
  console.error("✗", msg);
};

// 1. Синтаксис
const scripts = walk("scripts", [".mjs"]);
for (const file of scripts) {
  try {
    execFileSync(process.execPath, ["--check", join(root, file)], { stdio: "pipe" });
  } catch (err) {
    fail(`${file}: ${err.stderr?.toString().split("\n").slice(0, 4).join(" ")}`);
  }
}

// 2. Ключи перевода
const flat = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) => (typeof v === "object" ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
const langs = Object.fromEntries(
  ["ru", "en"].map((l) => [l, new Set(flat(JSON.parse(readFileSync(join(root, "lang", `${l}.json`), "utf8")).TAVERN))]),
);
const hasKey = (set, key) => set.has(key) || set.has(`${key}.other`);

const used = new Map();
const note = (key, file) => {
  if (key.includes("${") || key.endsWith(".")) return; // собирается на лету — проверяется семействами ниже
  if (!used.has(key)) used.set(key, file);
};
const templates = walk("templates", [".hbs"]);
for (const file of scripts) {
  const src = readFileSync(join(root, file), "utf8");
  for (const m of src.matchAll(/\b(?:t|has)\(\s*["'`]([A-Za-z0-9_.${}]+)["'`]/g)) note(m[1], file);
  for (const m of src.matchAll(/\bplural\([^,]+,\s*["'`]([A-Za-z0-9_.${}]+)["'`]/g)) note(m[1], file);
  for (const m of src.matchAll(/["'`]TAVERN\.([A-Za-z0-9_.]+)["'`]/g)) note(m[1], file);
}
for (const file of templates) {
  const src = readFileSync(join(root, file), "utf8");
  for (const m of src.matchAll(/TAVERN\.([A-Za-z0-9_.]+)/g)) note(m[1], file);
  for (const m of src.matchAll(/\{\{tgT\s+"([A-Za-z0-9_.]+)"/g)) note(m[1], file);
}
for (const [key, file] of used) {
  for (const [lang, set] of Object.entries(langs)) {
    if (!hasKey(set, key)) fail(`нет перевода (${lang}): ${key} — ${file}`);
  }
}

// Семейства ключей, которые собираются на лету.
const games = ["farkle", "liars", "poker", "kb", "tw", "scc"];
const families = [
  ...games.flatMap((g) => [`Game.${g}.name`, `Game.${g}.meta`, `Game.${g}.text`, `Rules.${g}`]),
  ...["cautious", "reckless", "counter", "simple"].map((x) => `Temper.${x}`),
  ...["tavern", "parchment"].map((x) => `Theme.${x}`),
  ...["pp", "gp", "ep", "sp", "cp"].map((x) => `Coin.${x}`),
  ...[1, 2, 3, 4, 5, 6].map((f) => `Liars.face.${f}`),
  ...["nothing", "pair", "twoPairs", "three", "smallStraight", "bigStraight", "fullHouse", "four", "five"].map((h) => `Poker.hand.${h}`),
  ...["bet1", "reroll", "bet2"].map((p) => `Poker.wait.${p}`),
  ...["first", "second", "third"].map((c) => `Kb.col.${c}`),
  ...["ship", "captain", "crew"].flatMap((k) => [`Scc.slot.${k}`, `Scc.need.${k}`]),
  ...[6, 5, 4].map((v) => `Scc.found.${v}`),
];
for (const key of families) {
  for (const [lang, set] of Object.entries(langs)) if (!hasKey(set, key)) fail(`нет перевода (${lang}): ${key}`);
}

// Подписи настроек игр и коды ошибок правил.
for (const g of games) {
  const def = (await import(join(root, "scripts/core/games", `${g}.mjs`))).default;
  for (const opt of def.options) {
    if (g === "poker" && opt.key === "raise") continue;
    for (const [lang, set] of Object.entries(langs)) {
      if (!hasKey(set, `Game.${g}.opt.${opt.key}`)) fail(`нет подписи настройки (${lang}): Game.${g}.opt.${opt.key}`);
    }
  }
  const src = readFileSync(join(root, "scripts/core/games", `${g}.mjs`), "utf8");
  for (const m of src.matchAll(/return\s+"([a-zA-Z]+)"\s*;/g)) {
    for (const [lang, set] of Object.entries(langs)) if (!hasKey(set, `Error.${m[1]}`)) fail(`нет текста ошибки (${lang}): Error.${m[1]} (${g})`);
  }
}

// 3. Шаблоны и файлы манифеста
for (const file of scripts) {
  const src = readFileSync(join(root, file), "utf8");
  for (const m of src.matchAll(/tpl\("([^"]+)"\)/g)) {
    if (!existsSync(join(root, "templates", m[1]))) fail(`нет шаблона templates/${m[1]} — ${file}`);
  }
  for (const m of src.matchAll(/from\s+"(\.[^"]+)"/g)) {
    if (!existsSync(join(root, file, "..", m[1]))) fail(`нет файла ${m[1]} — ${file}`);
  }
}
const manifest = JSON.parse(readFileSync(join(root, "module.json"), "utf8"));
for (const path of [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map((l) => l.path)]) {
  if (!existsSync(join(root, path))) fail(`module.json ссылается на отсутствующий файл: ${path}`);
}

console.log(problems ? `\nПроблем: ${problems}` : `✓ ${scripts.length} модулей, ${templates.length} шаблонов, ${used.size} ключей перевода — всё на месте`);
process.exit(problems ? 1 : 0);
