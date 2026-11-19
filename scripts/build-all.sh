#!/usr/bin/env bash
set -euo pipefail

# DoubleAgent Cross-Platform Build Script (Linux host -> builds Linux + Windows binaries)
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Ensure the Wails CLI is available. `go install` drops it into $GOPATH/bin,
# which is often not on PATH, so add it and install the module-pinned version if missing.
GOBIN_DIR="$(go env GOBIN)"
[ -z "$GOBIN_DIR" ] && GOBIN_DIR="$(go env GOPATH)/bin"
case ":$PATH:" in *":$GOBIN_DIR:"*) ;; *) export PATH="$GOBIN_DIR:$PATH" ;; esac
if ! command -v wails >/dev/null 2>&1; then
  WAILS_VERSION="$(go list -m -f '{{.Version}}' github.com/wailsapp/wails/v2 2>/dev/null || echo v2.17.1)"
  echo "==> Wails CLI not found; installing ${WAILS_VERSION} into ${GOBIN_DIR}..."
  go install "github.com/wailsapp/wails/v2/cmd/wails@${WAILS_VERSION}"
fi

echo "==> Building Frontend (creates frontend/dist for the Go embed)..."
(
  cd frontend
  npm ci --prefer-offline 2>/dev/null || npm install
  npm run lint
  npm run test -- --run
  npm run build
)

echo "==> Checking Go..."
go vet ./...
go test -count=1 ./...

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

echo "==> Building headless Linux Ephemeral Companion Agents (amd64 & arm64)..."
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o build/bin/doubleagent-agent-linux-amd64 ./cmd/doubleagent-agent
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o build/bin/doubleagent-agent-linux-arm64 ./cmd/doubleagent-agent

echo "==> Build complete:"
ls -lh build/bin/DoubleAgent-linux-amd64 build/bin/DoubleAgent.exe build/bin/doubleagent-agent-linux-*
echo "==> Tip: run ./scripts/install-linux.sh to install 'doubleagent' globally on Linux."
