#!/usr/bin/env bash
set -euo pipefail

# Install or uninstall DoubleAgent globally on Linux so it can be launched via `doubleagent`
# Usage:
#   ./scripts/install-linux.sh                          # System-wide (/usr/local/bin/doubleagent)
#   ./scripts/install-linux.sh --user                   # User-local (~/.local/bin/doubleagent, no sudo)
#   ./scripts/install-linux.sh --binary /path/to/bin    # Install a specific downloaded binary
#   ./scripts/install-linux.sh --uninstall [--user]     # Remove installed binary, icon, and desktop entry

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_MODE=false
UNINSTALL=false
BIN_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user)
      USER_MODE=true
      shift
      ;;
    --uninstall)
      UNINSTALL=true
      shift
      ;;
    --binary)
      BIN_PATH="${2:-}"
      shift 2
      ;;
    -h|--help)
      sed -n '3,10p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if $USER_MODE; then
  BIN_DIR="${HOME}/.local/bin"
  APP_DIR="${HOME}/.local/share/applications"
  ICON_DIR="${HOME}/.local/share/icons/hicolor/256x256/apps"
  SUDO=""
else
  BIN_DIR="/usr/local/bin"
  APP_DIR="/usr/local/share/applications"
  ICON_DIR="/usr/local/share/icons/hicolor/256x256/apps"
  SUDO=""
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    SUDO="sudo"
  fi
fi

TARGET_BIN="${BIN_DIR}/doubleagent"
TARGET_DESKTOP="${APP_DIR}/doubleagent.desktop"
TARGET_ICON="${ICON_DIR}/doubleagent.png"

if $UNINSTALL; then
  echo "==> Removing DoubleAgent from ${BIN_DIR}..."
  $SUDO rm -f "$TARGET_BIN" "$TARGET_DESKTOP" "$TARGET_ICON"
  command -v update-desktop-database >/dev/null 2>&1 && $SUDO update-desktop-database "$APP_DIR" 2>/dev/null || true
  echo "==> Uninstalled."
  exit 0
fi

# Locate binary if --binary was not provided
if [[ -z "$BIN_PATH" ]]; then
  for candidate in \
    "${ROOT_DIR}/build/bin/DoubleAgent-linux-amd64" \
    "${ROOT_DIR}/build/bin/DoubleAgent" \
    "./DoubleAgent-linux-amd64" \
    "./DoubleAgent"; do
    if [[ -f "$candidate" ]]; then
      BIN_PATH="$candidate"
      break
    fi
  done
fi

if [[ -z "$BIN_PATH" || ! -f "$BIN_PATH" ]]; then
  echo "ERROR: Linux binary not found. Build it first with ./scripts/build-all.sh or pass --binary <path>." >&2
  exit 1
fi

echo "==> Installing DoubleAgent binary to ${TARGET_BIN}..."
$SUDO install -d "$BIN_DIR" "$APP_DIR" "$ICON_DIR"
$SUDO install -m 0755 "$BIN_PATH" "$TARGET_BIN"

if [[ -f "${ROOT_DIR}/build/appicon.png" ]]; then
  $SUDO install -m 0644 "${ROOT_DIR}/build/appicon.png" "$TARGET_ICON"
fi

if [[ -f "${ROOT_DIR}/build/linux/doubleagent.desktop" ]]; then
  $SUDO install -m 0644 "${ROOT_DIR}/build/linux/doubleagent.desktop" "$TARGET_DESKTOP"
fi

command -v update-desktop-database >/dev/null 2>&1 && $SUDO update-desktop-database "$APP_DIR" 2>/dev/null || true

echo "==> Installed! You can now launch DoubleAgent from anywhere with:"
echo "    doubleagent"

if $USER_MODE && [[ ":${PATH}:" != *":${BIN_DIR}:"* ]]; then
  echo ""
  echo "NOTE: ${BIN_DIR} is not currently in your PATH. Add this to ~/.bashrc or ~/.zshrc:"
  echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
