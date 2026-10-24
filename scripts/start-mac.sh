#!/bin/bash
# Run the bot on macOS without Docker: keeps the Mac awake and restarts the bot if it crashes.
# With TELEGRAM_API_ID / TELEGRAM_API_HASH in .env it also runs the local telegram-bot-api server (files up to 2 GB, SPEC §2).
# Stop with Ctrl+C.
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Нет .env — скопируй .env.example в .env и впиши ключи"; exit 1; }
for bin in node yt-dlp gallery-dl; do
  command -v "$bin" >/dev/null || { echo "Не найден $bin — см. README, раздел «Без Docker»"; exit 1; }
done
[ -d node_modules ] || npm ci --omit=dev || exit 1

# Local Bot API server: a native build (scripts/build-bot-api.sh), no Docker. Without the keys — Telegram's cloud Bot API (20 MB).
envval() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d '\r' | sed -E "s/^[\"']//; s/[\"']$//"; }
API_ID=$(envval TELEGRAM_API_ID)
API_HASH=$(envval TELEGRAM_API_HASH)
SERVER_BIN="${BOT_API_BIN:-$HOME/.local/bin/telegram-bot-api}"
SERVER_PID=
if [ -n "$API_ID" ] && [ -n "$API_HASH" ]; then
  [ -x "$SERVER_BIN" ] || { echo "Ключи Telegram API есть, а сервера нет ($SERVER_BIN) — собери его: bash scripts/build-bot-api.sh"; exit 1; }
  export BOT_API_URL=http://127.0.0.1:8081
  export BOT_API_DIR="$PWD/telegram-bot-api"
  mkdir -p telegram-bot-api/tmp
fi
start_server() {
  [ -n "$BOT_API_URL" ] || return 0
  kill -0 "$SERVER_PID" 2>/dev/null && return 0
  # Keys go through the environment, not the command line (not visible in `ps`).
  TELEGRAM_API_ID="$API_ID" TELEGRAM_API_HASH="$API_HASH" "$SERVER_BIN" --local \
    --http-ip-address=127.0.0.1 --http-port=8081 --dir="$BOT_API_DIR" --temp-dir="$BOT_API_DIR/tmp" \
    --log="$BOT_API_DIR/server.log" --log-max-file-size=10000000 --verbosity=1 &
  SERVER_PID=$!
  echo "telegram-bot-api запущен (файлы до 2 ГБ)"
  sleep 3
}

# -i: no idle sleep, -s: no system sleep on AC power, -m: disk stays awake; ends together with this script.
caffeinate -ims -w $$ &
trap 'echo; [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null; echo "Бот остановлен."; exit 0' INT TERM

while true; do
  start_server
  npm start
  # exit code 2 = ошибка в .env: перезапуск не поможет
  [ $? -eq 2 ] && { echo "Исправь .env и запусти снова: ./scripts/start-mac.sh"; [ -n "$SERVER_PID" ] && kill "$SERVER_PID"; exit 1; }
  echo "⚠️ бот упал ($(date '+%H:%M:%S')) — перезапуск через 10 секунд…"
  sleep 10
done
