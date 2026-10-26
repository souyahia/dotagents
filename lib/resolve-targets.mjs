/**
 * Read the install targets declared in targets.json.
 *
 * Shared by install (which installs into every target) and build (which only
 * looks, to tell you when a freshly built skill has nowhere to be read from or
 * a tool config file holds other hooks than the ones just built). Both must
 * agree on how `~` and `$VARIABLES` expand, or build would check directories
 * install never writes to.
 *
 * targets.local.json, when present, replaces targets.json entirely. Use it for
 * a machine whose layout differs from the one you commit.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { HOOK_TOOLS } from "./hooks.mjs";

const PATH_KINDS = ["skills", "instructions"];
export const KINDS = [...PATH_KINDS, "hooks"];

const SHARED_FILE = "targets.json";
const LOCAL_FILE = "targets.local.json";

const isFile = (target) => fs.existsSync(target) && fs.statSync(target).isFile();

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const expand = (raw) => {
  const withVariables = raw.replace(/\$(\w+)|\$\{(\w+)\}/g, (match, bare, braced) => {
    const value = process.env[bare ?? braced];
    return value === undefined ? match : value;
  });

  if (withVariables === "~" || withVariables.startsWith("~/")) {
    return path.resolve(path.join(os.homedir(), withVariables.slice(1)));
  }

  return path.resolve(withVariables);
};

const readPaths = ({ entries, label, source }) => {
  if (!Array.isArray(entries)) {
    throw new Error(`${source}: '${label}' must be a list`);
  }

  return entries.map((entry) => {
    if (typeof entry !== "string" || entry === "") {
      throw new Error(`${source}: every '${label}' entry must be a non empty path string`);
    }
    return expand(entry);
  });
};

const readHookTargets = ({ hooks, source }) => {
  if (!isObject(hooks)) {
    throw new Error(`${source}: 'hooks' must be an object keyed by tool`);
  }

  const unknown = Object.keys(hooks).filter((tool) => !HOOK_TOOLS.includes(tool));
  if (unknown.length > 0) {
    throw new Error(
      `${source}: 'hooks' names unknown tool(s) ${unknown.sort().join(", ")}, expected ${HOOK_TOOLS.join(", ")}`,
    );
  }

  return Object.entries(hooks).flatMap(([tool, entries]) =>
    readPaths({ entries, label: `hooks.${tool}`, source }).map((targetPath) => ({
      kind: "hooks",
      tool,
      path: targetPath,
    })),
  );
};

/**
 * Returns one `{ kind, path }` per declared target, plus the `tool` of a hooks
 * target, ordered by kind then by declaration. Throws with a caller facing
 * message when the file is missing or malformed, so a CLI can exit on it and
 * the build can ignore it.
 */
export const resolveTargets = ({ home }) => {
  const localPath = path.join(home, LOCAL_FILE);
  const sharedPath = path.join(home, SHARED_FILE);
  const source = isFile(localPath) ? localPath : sharedPath;

  if (!isFile(source)) {
    throw new Error(`no ${SHARED_FILE} found in ${home}, so there is nowhere to install`);
  }

  const parsed = (() => {
    try {
      return JSON.parse(fs.readFileSync(source, "utf8"));
    } catch (error) {
      throw new Error(`${source} could not be read as JSON: ${error.message}`);
    }
  })();

  if (!isObject(parsed)) {
    throw new Error(`${source} must contain a JSON object`);
  }

  const unknown = Object.keys(parsed).filter((key) => !KINDS.includes(key));
  if (unknown.length > 0) {
    throw new Error(
      `${source}: unknown key(s) ${unknown.sort().join(", ")}, expected ${KINDS.join(", ")}`,
    );
  }

  const pathTargets = PATH_KINDS.flatMap((kind) =>
    readPaths({ entries: parsed[kind] ?? [], label: kind, source }).map((targetPath) => ({
      kind,
      path: targetPath,
    })),
  );

  return [...pathTargets, ...readHookTargets({ hooks: parsed.hooks ?? {}, source })];
};
