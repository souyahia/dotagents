/**
 * Read the install targets declared in targets.json.
 *
 * Shared by install (which links into every target) and build (which only
 * looks, to tell you when a freshly built skill has nowhere to be read from).
 * Both must agree on how `~` and `$VARIABLES` expand, or build would check
 * directories install never writes to.
 *
 * targets.local.json, when present, replaces targets.json entirely. Use it for
 * a machine whose layout differs from the one you commit.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const KINDS = ["skills", "instructions"];

const SHARED_FILE = "targets.json";
const LOCAL_FILE = "targets.local.json";

const isFile = (target) => fs.existsSync(target) && fs.statSync(target).isFile();

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

/**
 * Returns one `{ kind, path }` per declared target, ordered by kind then by
 * declaration. Throws with a caller facing message when the file is missing or
 * malformed, so a CLI can exit on it and the build can ignore it.
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

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${source} must contain a JSON object`);
  }

  const unknown = Object.keys(parsed).filter((key) => !KINDS.includes(key));
  if (unknown.length > 0) {
    throw new Error(
      `${source}: unknown key(s) ${unknown.sort().join(", ")}, expected ${KINDS.join(" and ")}`,
    );
  }

  const resolved = [];

  for (const kind of KINDS) {
    const entries = parsed[kind] ?? [];
    if (!Array.isArray(entries)) {
      throw new Error(`${source}: '${kind}' must be a list`);
    }

    for (const entry of entries) {
      if (typeof entry !== "string" || entry === "") {
        throw new Error(`${source}: every '${kind}' entry must be a non empty path string`);
      }
      resolved.push({ kind, path: expand(entry) });
    }
  }

  return resolved;
};
