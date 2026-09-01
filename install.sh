#!/usr/bin/env bash
# Bootstrap the Claude global config on macOS / Linux.
#
# Everything real happens in tools/install.mjs. This wrapper exists only to guarantee a
# Node runtime is present first, because a fresh Claude Desktop install does not ship one
# (Claude Code uses a native binary, not npm).
#
#   ./install.sh
#   ./install.sh --dry-run
#   ./install.sh --yes --skip-library

set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

green() { printf '  \033[32mok\033[0m    %s\n' "$1"; }
warn()  { printf '  \033[33mwarn\033[0m  %s\n' "$1"; }
err()   { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }

ASSUME_YES=0
PASS=()
for a in "$@"; do
  case "$a" in
    --yes|-y) ASSUME_YES=1 ;;
    *) PASS+=("$a") ;;
  esac
done

printf '\n\033[36mClaude Global Config - POSIX bootstrap\033[0m\n  repo %s\n\n' "$REPO"

node_ok=0
if command -v node >/dev/null 2>&1; then
  v="$(node --version | sed 's/^v//')"
  major="${v%%.*}"
  if [ "$major" -ge 20 ]; then green "node $v"; node_ok=1
  else warn "node $v is too old - need 20 or newer"; fi
fi

if [ "$node_ok" -eq 0 ]; then
  warn 'Node 20+ is required and was not found.'
  install_cmd=""
  if command -v brew >/dev/null 2>&1;      then install_cmd="brew install node"
  elif command -v apt-get >/dev/null 2>&1; then install_cmd="sudo apt-get update && sudo apt-get install -y nodejs npm"
  elif command -v dnf >/dev/null 2>&1;     then install_cmd="sudo dnf install -y nodejs"
  elif command -v pacman >/dev/null 2>&1;  then install_cmd="sudo pacman -S --noconfirm nodejs npm"
  fi

  if [ -n "$install_cmd" ]; then
    go=$ASSUME_YES
    if [ "$go" -eq 0 ]; then
      printf '  Install Node now with: %s\n' "$install_cmd"
      read -r -p '  Proceed? [y/N] ' ans
      case "$ans" in [Yy]*) go=1 ;; esac
    fi
    if [ "$go" -eq 1 ]; then
      eval "$install_cmd"
      command -v node >/dev/null 2>&1 || { err 'Node still not on PATH. Open a new shell and re-run.'; exit 1; }
      green "node $(node --version)"
    else
      err 'Cannot continue without Node. See https://nodejs.org'; exit 1
    fi
  else
    err 'No supported package manager found. Install Node 20+ from https://nodejs.org and re-run.'; exit 1
  fi
fi

command -v git >/dev/null 2>&1 || \
  warn 'git not found - the Tier-3 skill library cannot be cloned. Everything else still installs.'

node "$REPO/tools/install.mjs" ${PASS+"${PASS[@]}"}

printf '\n\033[36mVerify with:\033[0m\n  node "%s/tools/doctor.mjs"\n\n' "$REPO"
