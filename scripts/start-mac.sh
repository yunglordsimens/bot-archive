#!/bin/bash
# Run the bot on macOS without Docker: keeps the Mac awake and restarts the bot if it crashes.
# Stop with Ctrl+C.
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Нет .env — скопируй .env.example в .env и впиши ключи"; exit 1; }
for bin in node yt-dlp gallery-dl; do
  command -v "$bin" >/dev/null || { echo "Не найден $bin — см. README, раздел «Без Docker»"; exit 1; }
done
[ -d node_modules ] || npm ci --omit=dev || exit 1

# -i: no idle sleep, -s: no system sleep on AC power, -m: disk stays awake; ends together with this script.
caffeinate -ims -w $$ &
trap 'echo; echo "Бот остановлен."; exit 0' INT TERM

while true; do
  npm start
  echo "⚠️ бот упал ($(date '+%H:%M:%S')) — перезапуск через 10 секунд…"
  sleep 10
done
