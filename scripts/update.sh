#!/bin/bash
# Download the latest code from GitHub into this folder. .env stays untouched.
set -e
cd "$(dirname "$0")/.."
curl -fsSL https://github.com/yunglordsimens/bot-archive/archive/refs/heads/main.tar.gz | tar xz --strip-components=1
npm ci --omit=dev
echo "Обновлено. Запусти бота: bash scripts/start-mac.sh"
