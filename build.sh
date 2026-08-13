#!/usr/bin/env bash
#
# Renders the dotagents source tree into dist/.
#
# This script never touches anything outside DOTAGENTS_HOME, so it is always
# safe to run. Use ./install.sh to wire dist/ into your agent config dirs.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTAGENTS_HOME="${DOTAGENTS_HOME:-$REPO_DIR}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required but was not found on PATH" >&2
  exit 1
fi

exec python3 "$REPO_DIR/lib/build.py" --home "$DOTAGENTS_HOME" "$@"
