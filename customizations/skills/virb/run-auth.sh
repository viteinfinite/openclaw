#!/usr/bin/env bash
# Runs the vendored virb CLI with X/Twitter cookies supplied at runtime.
#
# Cookie values are read by this script from a keychain item or a 0600 file and
# exported straight into the child process. They are never echoed, logged, or
# passed as CLI args (so they do not show up in `ps` or in tool output).
#
# Sources (first match wins per cookie):
#   1. macOS Keychain generic password, when BIRD_KEYCHAIN_SERVICE is set:
#        security add-generic-password -s "$BIRD_KEYCHAIN_SERVICE" -a AUTH_TOKEN -w
#        security add-generic-password -s "$BIRD_KEYCHAIN_SERVICE" -a CT0        -w
#   2. A dotenv-style file (default ~/.config/bird/cookies.env, override with
#      BIRD_COOKIE_FILE). Expected lines:
#        AUTH_TOKEN=...
#        CT0=...
#      Create it yourself and `chmod 600` it; the agent never reads it.
set -euo pipefail

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

read_cookie() {
  local name="$1"
  if [[ -n "${BIRD_KEYCHAIN_SERVICE:-}" ]]; then
    local value
    if value="$(security find-generic-password -w -s "$BIRD_KEYCHAIN_SERVICE" -a "$name" 2>/dev/null)"; then
      [[ -n "$value" ]] && { printf '%s' "$value"; return 0; }
    fi
  fi
  local file="${BIRD_COOKIE_FILE:-$HOME/.config/bird/cookies.env}"
  if [[ -r "$file" ]]; then
    awk -F= -v key="$name" '
      $1 == key { sub(/^[^=]*=/, ""); sub(/\r$/, ""); print; exit }
    ' "$file"
  fi
}

if [[ -z "${AUTH_TOKEN:-}" ]]; then
  AUTH_TOKEN="$(read_cookie AUTH_TOKEN)"
  export AUTH_TOKEN
fi
if [[ -z "${CT0:-}" ]]; then
  CT0="$(read_cookie CT0)"
  export CT0
fi

exec node "$skill_dir/package/dist/cli.js" "$@"
