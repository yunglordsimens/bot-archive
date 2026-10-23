#!/bin/bash
# Build and start the bot in Docker Desktop, then follow logs while keeping the Mac awake.
set -e
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Нет .env — скопируй .env.example в .env и впиши ключи"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker Desktop не запущен — открой его и повтори"; exit 1; }
docker compose up -d --build
echo "Бот запущен. Мак не уснёт, пока открыты логи (Ctrl+C — выйти из логов, бот продолжит работать)."
exec caffeinate -ims docker compose logs -f
