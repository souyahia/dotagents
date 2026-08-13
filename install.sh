#!/usr/bin/env bash
#
# Builds the source tree, then symlinks dist/ into every directory declared in
# targets.json. A fresh clone only needs this script.
#
# Re-run it whenever a skill is added or removed. Each target holds one symlink
# per skill, so a new skill has nothing pointing at it until this runs. Editing
# an existing skill needs only ./build.sh, because its link already resolves
# into dist/. Re-running is safe: links that are already correct are left alone.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTAGENTS_HOME="${DOTAGENTS_HOME:-$REPO_DIR}"
DIST="$DOTAGENTS_HOME/dist"

IS_DRY_RUN=false
SHOULD_FORCE=false
SHOULD_BUILD=true
PREFIX=""
TILDE="~"

for argument in "$@"; do
  case "$argument" in
  --dry-run) IS_DRY_RUN=true ;;
  --force) SHOULD_FORCE=true ;;
  --no-build) SHOULD_BUILD=false ;;
  -h | --help)
    echo "usage: ./install.sh [--dry-run] [--force] [--no-build]"
    echo
    echo "  --dry-run   print what would change outside this repository, then stop"
    echo "  --force     replace entries that dotagents did not create (backs up real files)"
    echo "  --no-build  install the existing dist/ instead of rebuilding it first"
    exit 0
    ;;
  *)
    echo "error: unknown argument '$argument'" >&2
    exit 1
    ;;
  esac
done

if [ "$IS_DRY_RUN" = true ]; then
  PREFIX="would "
fi

if [ "$IS_DRY_RUN" = true ]; then
  echo "dry run, nothing outside this repository will be modified"
  echo
fi

if [ "$SHOULD_BUILD" = true ]; then
  echo "building"
  DOTAGENTS_HOME="$DOTAGENTS_HOME" "$REPO_DIR/build.sh" --no-link-check | sed 's/^/  /'
  echo
fi

if [ ! -d "$DIST/skills" ]; then
  echo "error: no build found at $DIST" >&2
  echo "run ./build.sh, or drop --no-build so install builds for you" >&2
  exit 1
fi

run() {
  if [ "$IS_DRY_RUN" = true ]; then
    return 0
  fi
  "$@"
}

pretty_path() {
  echo "${1/#$HOME/$TILDE}"
}

# Prints the raw target of a symlink. We always create absolute links, so the
# raw value is enough to tell ours apart from someone else's.
link_target() {
  readlink "$1" 2>/dev/null || true
}

is_ours() {
  case "$(link_target "$1")" in
  "$DIST"/*) return 0 ;;
  *) return 1 ;;
  esac
}

install_link() {
  local source_path="$1" target_path="$2"
  local label
  label="$(pretty_path "$target_path")"

  if [ -L "$target_path" ]; then
    if [ "$(link_target "$target_path")" = "$source_path" ]; then
      return 0
    fi
    if is_ours "$target_path" || [ "$SHOULD_FORCE" = true ]; then
      run rm -f "$target_path"
    else
      echo "  skip $label"
      echo "       points at $(link_target "$target_path"), which dotagents did not create"
      echo "       re-run with --force to replace it"
      return 0
    fi
  elif [ -e "$target_path" ]; then
    if [ "$SHOULD_FORCE" = true ]; then
      echo "  ${PREFIX}back up $label to $label.bak"
      run rm -rf "$target_path.bak"
      run mv "$target_path" "$target_path.bak"
    else
      echo "  skip $label"
      echo "       a real file or directory is already there"
      echo "       re-run with --force to back it up and replace it"
      return 0
    fi
  fi

  run ln -s "$source_path" "$target_path"
  echo "  ${PREFIX}link $label"
}

# Removes links we created for skills that no longer exist in dist/.
prune_stale_links() {
  local target_dir="$1"
  local entry name

  [ -d "$target_dir" ] || return 0

  for entry in "$target_dir"/*; do
    [ -L "$entry" ] || continue
    is_ours "$entry" || continue

    name="$(basename "$entry")"
    if [ ! -d "$DIST/skills/$name" ]; then
      run rm -f "$entry"
      echo "  ${PREFIX}remove $(pretty_path "$entry"), no longer in the build"
    fi
  done
}

install_skills_into() {
  local target_dir="$1"
  local skill name

  echo "$(pretty_path "$target_dir")"
  run mkdir -p "$target_dir"

  for skill in "$DIST"/skills/*/; do
    [ -d "$skill" ] || continue
    name="$(basename "$skill")"
    install_link "$DIST/skills/$name" "$target_dir/$name"
  done

  prune_stale_links "$target_dir"
  echo
}

install_instruction_link() {
  local target_path="$1"

  if [ ! -f "$DIST/instructions.md" ]; then
    echo "  skip $(pretty_path "$target_path"), the build produced no instructions.md"
    return 0
  fi

  run mkdir -p "$(dirname "$target_path")"
  install_link "$DIST/instructions.md" "$target_path"
}

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required but was not found on PATH" >&2
  echo "dotagents needs Node.js 18 or newer" >&2
  exit 1
fi

TARGETS="$(node "$REPO_DIR/lib/targets.mjs" --home "$DOTAGENTS_HOME")"

HAS_INSTRUCTION_HEADER=false

while IFS=$'\t' read -r kind path; do
  [ -n "$kind" ] || continue

  case "$kind" in
  skills)
    install_skills_into "$path"
    ;;
  instructions)
    if [ "$HAS_INSTRUCTION_HEADER" = false ]; then
      echo "instructions"
      HAS_INSTRUCTION_HEADER=true
    fi
    install_instruction_link "$path"
    ;;
  esac
done <<<"$TARGETS"

if [ "$HAS_INSTRUCTION_HEADER" = true ]; then
  echo
fi

echo "done. ./build.sh is enough after editing a skill, re-run this one when you add or remove one."
