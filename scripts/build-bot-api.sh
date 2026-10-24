#!/bin/bash
# Run once: bash scripts/build-bot-api.sh (needs: brew install cmake gperf openssl@3). Takes 30–60 min, close heavy apps.
# One-time build of tdlib/telegram-bot-api for macOS (arm64). Binary → ~/.local/bin/telegram-bot-api.
set -euo pipefail
SRC="$HOME/.local/src/telegram-bot-api"
mkdir -p "$HOME/.local/src" "$HOME/.local/bin"
if [ ! -d "$SRC/.git" ]; then
  git clone --depth 1 --recurse-submodules --shallow-submodules https://github.com/tdlib/telegram-bot-api.git "$SRC"
fi
cd "$SRC"
echo "commit: $(git rev-parse --short HEAD) td: $(git -C td rev-parse --short HEAD)"
# An interrupted build continues where it stopped (make skips files already compiled).
mkdir -p build && cd build
cmake -DCMAKE_BUILD_TYPE=Release -DOPENSSL_ROOT_DIR="$(brew --prefix openssl@3)" \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DCMAKE_INSTALL_PREFIX:PATH="$HOME/.local" ..
# -j2: two compile jobs — the heaviest TDLib files need ~1.5 GB each, the Mac has 8 GB.
cmake --build . --target install -j 2
"$HOME/.local/bin/telegram-bot-api" --version
# Build files are no longer needed (the disk is almost full).
cd "$SRC" && rm -rf build
echo "BUILD_OK"
