# -*- coding: utf-8 -*-
"""Собирает lang/ru.json и lang/en.json из словарей и сверяет наборы ключей."""
import json, os, sys, runpy

here = os.path.dirname(os.path.abspath(__file__))
RU = runpy.run_path(os.path.join(here, "lang-ru.py"))["RU"]
EN = runpy.run_path(os.path.join(here, "lang-en.py"))["EN"]

PLURAL = {"one", "few", "many", "other"}

def flat(d, prefix=""):
    out = {}
    for k, v in d.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(flat(v, key))
        else:
            out[key] = v
    return out

def base_keys(d):
    keys = set()
    for k in flat(d):
        head, _, tail = k.rpartition(".")
        keys.add(head if tail in PLURAL else k)
    return keys

ru, en = base_keys(RU), base_keys(EN)
missing_en, missing_ru = sorted(ru - en), sorted(en - ru)
if missing_en or missing_ru:
    print("нет в en:", missing_en)
    print("нет в ru:", missing_ru)
    sys.exit(1)

root = os.path.dirname(here)
for name, data in (("ru", RU), ("en", EN)):
    with open(os.path.join(root, "lang", f"{name}.json"), "w", encoding="utf-8") as f:
        json.dump({"TAVERN": data}, f, ensure_ascii=False, indent=2)
        f.write("\n")
print("ключей:", len(flat(RU)), "ru /", len(flat(EN)), "en")
