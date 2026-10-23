#!/bin/bash
# Run the bot on macOS without Docker, keeping the Mac awake while it runs.
# -i: no idle sleep, -s: no system sleep on AC power, -m: disk stays awake.
set -e
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Нет .env — скопируй .env.example в .env и впиши ключи"; exit 1; }
for bin in node yt-dlp gallery-dl; do
  command -v "$bin" >/dev/null || { echo "Не найден $bin — см. README, раздел «Без Docker»"; exit 1; }
done
[ -d node_modules ] || npm ci --omit=dev
exec caffeinate -ims npm start
