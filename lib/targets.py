#!/usr/bin/env python3
"""Resolve the install targets declared in targets.json.

Prints one tab separated row per declared target:

    <kind>\t<absolute path>

`kind` is "skills" for a directory that receives one symlink per built skill, or
"instructions" for a single symlink to the rendered instructions file. Every
declared target is installed, and its directories are created if missing.

targets.local.json, when present, replaces targets.json entirely. Use it for a
machine whose layout differs from the one you commit.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

KINDS = ("skills", "instructions")
SHARED_FILE = "targets.json"
LOCAL_FILE = "targets.local.json"


def fail(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def expand(raw: str) -> Path:
    return Path(os.path.expandvars(os.path.expanduser(raw)))


def main() -> None:
    parser = argparse.ArgumentParser(description="Resolve dotagents install targets.")
    parser.add_argument("--home", required=True, help="directory holding targets.json")
    arguments = parser.parse_args()

    home = Path(arguments.home).expanduser().resolve()

    source = home / LOCAL_FILE
    if not source.is_file():
        source = home / SHARED_FILE
    if not source.is_file():
        fail(f"no {SHARED_FILE} found in {home}, so there is nowhere to install")

    try:
        data = json.loads(source.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        fail(f"{source} is not valid JSON: {error}")

    if not isinstance(data, dict):
        fail(f"{source} must contain a JSON object, got {type(data).__name__}")

    unknown = set(data) - set(KINDS)
    if unknown:
        fail(f"{source}: unknown key(s) {', '.join(sorted(unknown))}, expected {' and '.join(KINDS)}")

    for kind in KINDS:
        entries = data.get(kind, [])
        if not isinstance(entries, list):
            fail(f"{source}: '{kind}' must be a list, got {type(entries).__name__}")

        for entry in entries:
            if not isinstance(entry, str) or not entry:
                fail(f"{source}: every '{kind}' entry must be a non empty path string")
            print(f"{kind}\t{expand(entry)}")


if __name__ == "__main__":
    main()
