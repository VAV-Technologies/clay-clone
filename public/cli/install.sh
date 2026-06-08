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

# Configure the API key if it was provided inline
# (e.g. curl -fsSL .../install.sh | DATAFLOW_API_KEY='...' bash).
key_configured=0
if [ -n "${DATAFLOW_API_KEY:-}" ]; then
  "$BIN_PATH" set-key "$DATAFLOW_API_KEY" >/dev/null
  echo "configured API key"
  key_configured=1
fi

# Install the global Claude Code skill so Claude becomes Agent X in any folder on this device.
SKILL_DIR="$HOME/.claude/skills/dataflow"
if mkdir -p "$SKILL_DIR" 2>/dev/null && {
     { command -v curl >/dev/null 2>&1 && curl -fsSL "$BASE_URL/cli/dataflow-skill.md" -o "$SKILL_DIR/SKILL.md"; } ||
     { command -v wget >/dev/null 2>&1 && wget -qO "$SKILL_DIR/SKILL.md" "$BASE_URL/cli/dataflow-skill.md"; }
   }; then
  echo "installed Claude Code skill: dataflow"
else
  echo "note: could not install the dataflow Claude Code skill (skipped)"
fi

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
if [ "$key_configured" -eq 1 ]; then
  echo "ready - open Claude Code in any folder and describe your campaign."
  echo "  e.g. \"find me 500 manufacturing CFOs in Vietnam and get their emails\""
  echo "  or try a quick read:  agent-x api GET /api/projects"
else
  echo "next steps:"
  echo "  agent-x set-key <DATAFLOW_API_KEY>"
  echo "  agent-x docs                              # rules + API spec"
  echo "  agent-x api GET /api/projects             # try a quick read"
fi
