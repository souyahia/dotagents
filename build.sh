#!/usr/bin/env bash
#
# Renders the dotagents source tree into dist/.
#
# Writes nothing outside DOTAGENTS_HOME, so it is always safe to run. It does
# read the install targets to warn when a built skill is linked nowhere; pass
# --no-link-check to skip that.
#
# Use ./install.sh to wire dist/ into your agent config dirs, and again whenever
# a skill is added or removed.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTAGENTS_HOME="${DOTAGENTS_HOME:-$REPO_DIR}"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required but was not found on PATH" >&2
  echo "dotagents needs Node.js 18 or newer" >&2
  exit 1
fi

exec node "$REPO_DIR/lib/build.mjs" --home "$DOTAGENTS_HOME" "$@"
