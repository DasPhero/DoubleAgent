#!/usr/bin/env bash
set -euo pipefail

# DoubleAgent Cross-Platform Build Script (Linux host -> builds Linux + Windows binaries)
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Checking Go & Frontend..."
go vet ./...
go test -count=1 ./...

(
  cd frontend
  npm ci --prefer-offline 2>/dev/null || npm install
  npx tsc --noEmit
  npm run lint
  npm run test -- --run
)

# Auto-detect WebKit2GTK 4.1 (Ubuntu 24.04+, Debian 12+, Kali, Arch, Fedora) vs 4.0
WAILS_LINUX_TAGS=""
if pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  WAILS_LINUX_TAGS="-tags webkit2_41"
  echo "==> Detected webkit2gtk-4.1 (using -tags webkit2_41)"
elif pkg-config --exists webkit2gtk-4.0 2>/dev/null; then
  echo "==> Detected webkit2gtk-4.0"
else
  echo "ERROR: Neither webkit2gtk-4.1 nor webkit2gtk-4.0 found via pkg-config."
  echo "Install on Debian/Ubuntu/Kali: sudo apt-get install -y build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev"
  exit 1
fi

echo "==> Building Linux amd64 standalone binary..."
# shellcheck disable=SC2086
wails build $WAILS_LINUX_TAGS -platform linux/amd64 -o DoubleAgent-linux-amd64

echo "==> Cross-building Windows amd64 standalone binary..."
wails build -platform windows/amd64 -o DoubleAgent.exe -s

echo "==> Build complete:"
ls -lh build/bin/DoubleAgent-linux-amd64 build/bin/DoubleAgent.exe
echo "==> Tip: run ./scripts/install-linux.sh to install 'doubleagent' globally on Linux."
