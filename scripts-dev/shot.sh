#!/bin/zsh
# Снимок окна со стенда (dev/harness) в безголовом Chrome.
#   scripts-dev/shot.sh <out.png> <ширина> <высота> '<js-сценарий>' ['&lang=en']
# Сценарий выполняется после загрузки стенда, tavern = window.__tavern (см. dev/harness/harness.js).
# Нужен запущенный сервер: python3 -m http.server 8765 --bind 127.0.0.1 (из корня репозитория).
# CSS-анимации в безголовом режиме стоят на первом кадре — для снимка их стоит выключить:
#   document.head.insertAdjacentHTML('beforeend','<style>*{animation:none!important}</style>');
OUT="$1"; W="$2"; H="$3"; JS="$4"; Q="$5"
ENC=$(python3 -c "import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))" "$JS")
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=$W,$H --virtual-time-budget=9000 \
  --screenshot="$OUT" "http://localhost:8765/dev/harness/index.html?bare=1${Q}&do=${ENC}" >/dev/null 2>&1
ls -la "$OUT" | awk '{print $5, $9}'
