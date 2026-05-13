#!/usr/bin/env bash
# agent-x installer (bash). Pipe-installable:
#   curl -fsSL https://dataflow-pi.vercel.app/cli/install.sh | bash
#
# Env overrides:
#   DATAFLOW_BASE_URL       default https://dataflow-pi.vercel.app
#   AGENT_X_INSTALL_DIR     default $HOME/.local/bin

set -euo pipefail

BASE_URL="${DATAFLOW_BASE_URL:-https://dataflow-pi.vercel.app}"
BIN_URL="$BASE_URL/cli/agent-x"
BIN_DIR="${AGENT_X_INSTALL_DIR:-$HOME/.local/bin}"
BIN_PATH="$BIN_DIR/agent-x"

if ! command -v node >/dev/null 2>&1; then
  echo "error: agent-x needs Node.js (>=18). Install Node and re-run." >&2
  exit 1
fi

node_major=$(node -p "process.versions.node.split('.')[0]")
if [ "${node_major:-0}" -lt 18 ]; then
  echo "error: agent-x needs Node.js >= 18 (found $(node -v))" >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
echo "downloading $BIN_URL"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$BIN_URL" -o "$BIN_PATH"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$BIN_PATH" "$BIN_URL"
else
  echo "error: need curl or wget" >&2
  exit 1
fi
chmod +x "$BIN_PATH"

echo "installed: $BIN_PATH"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo
    echo "note: $BIN_DIR is not on \$PATH."
    echo "add this to your shell rc (~/.bashrc, ~/.zshrc):"
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac

echo
echo "next steps:"
echo "  agent-x set-key <DATAFLOW_API_KEY>"
echo "  agent-x docs                              # rules + API spec"
echo "  agent-x api GET /api/projects             # try a quick read"
