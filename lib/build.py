#!/usr/bin/env python3
"""Render a dotagents source tree into dist/.

Source layout (under DOTAGENTS_HOME):

    src/instructions.md            shared agent instructions
    src/vars.default.json          declares every known variable
    src/skills/<name>/SKILL.md     shared skills
    src/machines/<id>/vars.json    per machine variable overrides
    src/machines/<id>/instructions.md   appended to the shared instructions
    src/machines/<id>/skills/      machine only skills, override shared by name
    vars.local.json                gitignored overrides and secrets
    .machine                       gitignored machine identity

Variables are written as {{UPPER_SNAKE}} and substituted in .md and .txt files.
A reference with no value is a build error, never a silent empty string.
Write {{!NAME}} to emit a literal {{NAME}} without substituting it.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import sys
from pathlib import Path

VAR_PATTERN = re.compile(r"\{\{\s*(!?)\s*([A-Z][A-Z0-9_]*)\s*\}\}")
NAME_PATTERN = re.compile(r"[A-Z][A-Z0-9_]*")
RENDERED_SUFFIXES = {".md", ".txt"}
SKILL_ENTRYPOINT = "SKILL.md"

DEFAULT_VARS_LAYER = "src/vars.default.json"
LOCAL_VARS_LAYER = "vars.local.json"


def fail(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def warn(message: str) -> None:
    print(f"warning: {message}", file=sys.stderr)


def resolve_machine(home: Path) -> tuple[str, str]:
    """Return the machine id and where it came from.

    Order: DOTAGENTS_MACHINE, then the .machine file, then the short hostname.
    """
    from_env = os.environ.get("DOTAGENTS_MACHINE", "").strip()
    if from_env:
        return from_env, "DOTAGENTS_MACHINE"

    machine_file = home / ".machine"
    if machine_file.is_file():
        from_file = machine_file.read_text(encoding="utf-8").strip()
        if from_file:
            return from_file, ".machine"

    return socket.gethostname().split(".")[0], "hostname"


def read_vars_file(path: Path) -> dict[str, str]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        fail(f"{path} is not valid JSON: {error}")
    except OSError as error:
        fail(f"could not read {path}: {error}")

    if not isinstance(data, dict):
        fail(f"{path} must contain a JSON object, got {type(data).__name__}")

    for name, value in data.items():
        if not NAME_PATTERN.fullmatch(str(name)):
            fail(f"{path} declares '{name}', but names must be UPPER_SNAKE_CASE")
        if not isinstance(value, str):
            fail(f"{path} sets '{name}' to a {type(value).__name__}, but every value must be a string")

    return data


def load_variables(home: Path, machine_dir: Path | None) -> tuple[dict[str, str], dict[str, str]]:
    """Merge the variable layers. Returns the merged map and each name's origin."""
    layers: list[tuple[str, Path]] = [(DEFAULT_VARS_LAYER, home / DEFAULT_VARS_LAYER)]
    if machine_dir is not None:
        layers.append((f"src/machines/{machine_dir.name}/vars.json", machine_dir / "vars.json"))
    layers.append((LOCAL_VARS_LAYER, home / LOCAL_VARS_LAYER))

    merged: dict[str, str] = {}
    origins: dict[str, str] = {}
    for label, path in layers:
        if not path.is_file():
            continue
        for name, value in read_vars_file(path).items():
            merged[name] = value
            origins[name] = label

    return merged, origins


def collect_skills(src: Path, machine_dir: Path | None) -> dict[str, tuple[Path, str]]:
    """Shared skills, then machine skills overriding them by name."""
    collected: dict[str, tuple[Path, str]] = {}

    sources: list[tuple[Path, str]] = [(src / "skills", "shared")]
    if machine_dir is not None:
        sources.append((machine_dir / "skills", "machine"))

    for skills_dir, layer in sources:
        if not skills_dir.is_dir():
            continue
        for entry in sorted(skills_dir.iterdir()):
            if not entry.is_dir() or entry.name.startswith("."):
                continue
            if not (entry / SKILL_ENTRYPOINT).is_file():
                fail(f"{entry} has no {SKILL_ENTRYPOINT}, so it is not a valid skill")
            collected[entry.name] = (entry, layer)

    return collected


def render_text(
    text: str,
    variables: dict[str, str],
    origin: Path,
    used: set[str],
    undefined: list[tuple[Path, int, str]],
) -> str:
    def replace(match: re.Match[str]) -> str:
        is_escaped = match.group(1) == "!"
        name = match.group(2)
        if is_escaped:
            return "{{" + name + "}}"
        if name in variables:
            used.add(name)
            return variables[name]
        line = text.count("\n", 0, match.start()) + 1
        undefined.append((origin, line, name))
        return match.group(0)

    return VAR_PATTERN.sub(replace, text)


def render_tree(
    source_dir: Path,
    target_dir: Path,
    variables: dict[str, str],
    used: set[str],
    undefined: list[tuple[Path, int, str]],
) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)

    for item in sorted(source_dir.rglob("*")):
        destination = target_dir / item.relative_to(source_dir)

        if item.is_dir():
            destination.mkdir(parents=True, exist_ok=True)
            continue

        destination.parent.mkdir(parents=True, exist_ok=True)

        if item.suffix.lower() not in RENDERED_SUFFIXES:
            shutil.copy2(item, destination)
            continue

        try:
            text = item.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            shutil.copy2(item, destination)
            continue

        destination.write_text(render_text(text, variables, item, used, undefined), encoding="utf-8")
        shutil.copymode(item, destination)


def build_instructions(
    home: Path,
    src: Path,
    machine_dir: Path | None,
    staging: Path,
    variables: dict[str, str],
    used: set[str],
    undefined: list[tuple[Path, int, str]],
) -> bool:
    shared = src / "instructions.md"
    fragment = machine_dir / "instructions.md" if machine_dir is not None else None

    sections: list[str] = []
    if shared.is_file():
        text = shared.read_text(encoding="utf-8")
        sections.append(render_text(text, variables, shared, used, undefined).rstrip())
    if fragment is not None and fragment.is_file():
        text = fragment.read_text(encoding="utf-8")
        sections.append(render_text(text, variables, fragment, used, undefined).rstrip())

    if not sections:
        return False

    (staging / "instructions.md").write_text("\n\n".join(sections) + "\n", encoding="utf-8")
    return True


def report_undefined(undefined: list[tuple[Path, int, str]], home: Path) -> None:
    print("error: undefined variables referenced in the source tree", file=sys.stderr)
    for origin, line, name in undefined:
        try:
            shown = origin.relative_to(home)
        except ValueError:
            shown = origin
        print(f"  {shown}:{line}: {{{{{name}}}}}", file=sys.stderr)
    print(
        f"\nDefine them in {DEFAULT_VARS_LAYER}, in the machine's vars.json, or in {LOCAL_VARS_LAYER}.",
        file=sys.stderr,
    )
    sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Render the dotagents source tree into dist/.")
    parser.add_argument("--home", required=True, help="directory holding src/, dist/ and the local overrides")
    arguments = parser.parse_args()

    home = Path(arguments.home).expanduser().resolve()
    src = home / "src"
    if not src.is_dir():
        fail(f"no src/ directory under {home}")

    machine, machine_source = resolve_machine(home)
    machine_dir: Path | None = src / "machines" / machine
    is_explicit = machine_source != "hostname"

    if not machine_dir.is_dir():
        if is_explicit:
            fail(f"{machine_source} names machine '{machine}', but src/machines/{machine}/ does not exist")
        machine_dir = None

    variables, origins = load_variables(home, machine_dir)
    skills = collect_skills(src, machine_dir)

    staging = home / ".dist.tmp"
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)

    used: set[str] = set()
    undefined: list[tuple[Path, int, str]] = []

    for name, (path, _layer) in skills.items():
        render_tree(path, staging / "skills" / name, variables, used, undefined)

    has_instructions = build_instructions(home, src, machine_dir, staging, variables, used, undefined)

    if undefined:
        shutil.rmtree(staging, ignore_errors=True)
        report_undefined(undefined, home)

    dist = home / "dist"
    shutil.rmtree(dist, ignore_errors=True)
    staging.rename(dist)

    machine_label = machine if machine_dir is not None else f"{machine} (no machine layer)"
    overridden = [name for name, (_path, layer) in skills.items() if layer == "machine"]

    print(f"machine:      {machine_label} (from {machine_source})")
    print(f"skills:       {len(skills)} built" + (f", {len(overridden)} from the machine layer" if overridden else ""))
    print(f"instructions: {'built' if has_instructions else 'none'}")
    print(f"output:       {dist}")

    for name in sorted(origins):
        if origins[name] == DEFAULT_VARS_LAYER or name in used:
            continue
        warn(f"'{name}' is set in {origins[name]} but no source file references it")


if __name__ == "__main__":
    main()
