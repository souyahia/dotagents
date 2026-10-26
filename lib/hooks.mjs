/**
 * Merge the built hooks into the config file of each tool that runs them.
 *
 * A hook's hook.json holds its entries per tool, each in that tool's own hooks
 * format. Tools rewrite their config files themselves, and other tools add
 * their own hooks to them, so a config file cannot be a symlink into dist/ the
 * way skills and instructions are. Ownership is decided by path instead: a hook
 * whose command runs something from dist/ belongs to dotagents. Installing
 * replaces those and leaves every other hook and setting as it found them.
 */

import fs from "node:fs";
import path from "node:path";

export const HOOK_TOOLS = ["claude", "codex"];
export const HOOK_MANIFEST = "hook.json";

const HOOK_DIR_TOKEN = "${DOTAGENTS_HOOK_DIR}";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${filePath} could not be read as JSON: ${error.message}`);
  }
};

const validateEntries = ({ entries, label }) => {
  if (!isObject(entries)) {
    throw new Error(`${label} must be an object keyed by hook event`);
  }

  for (const [event, groups] of Object.entries(entries)) {
    const isValid =
      Array.isArray(groups) && groups.every((group) => isObject(group) && Array.isArray(group.hooks));
    if (!isValid) {
      throw new Error(`${label}: '${event}' must be a list of objects that each hold a 'hooks' list`);
    }
  }
};

/** Reads a hook.json, keyed by tool. Throws with a caller facing message. */
export const readHookManifest = (filePath) => {
  const manifest = readJson(filePath);
  if (!isObject(manifest)) {
    throw new Error(`${filePath} must contain a JSON object keyed by tool`);
  }

  const tools = Object.keys(manifest);
  const unknown = tools.filter((tool) => !HOOK_TOOLS.includes(tool));
  if (unknown.length > 0) {
    throw new Error(
      `${filePath}: unknown tool(s) ${unknown.sort().join(", ")}, expected ${HOOK_TOOLS.join(", ")}`,
    );
  }
  if (tools.length === 0) {
    throw new Error(`${filePath} names no tool, expected at least one of ${HOOK_TOOLS.join(", ")}`);
  }

  for (const tool of tools) {
    validateEntries({ entries: manifest[tool], label: `${filePath}: '${tool}'` });
  }

  return manifest;
};

const readConfig = (configPath) => {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  const config = readJson(configPath);
  if (!isObject(config)) {
    throw new Error(`${configPath} must contain a JSON object`);
  }

  return config;
};

const resolveCommands = ({ entries, hookDir }) =>
  Object.fromEntries(
    Object.entries(entries).map(([event, groups]) => [
      event,
      groups.map((group) => ({
        ...group,
        hooks: group.hooks.map((hook) =>
          typeof hook.command === "string"
            ? { ...hook, command: hook.command.replaceAll(HOOK_DIR_TOKEN, hookDir) }
            : hook,
        ),
      })),
    ]),
  );

const appendHooks = ({ hooks, added }) =>
  Object.entries(added).reduce(
    (merged, [event, groups]) => ({
      ...merged,
      [event]: [...(Array.isArray(merged[event]) ? merged[event] : []), ...groups],
    }),
    hooks,
  );

const collectBuiltHooks = ({ home, tool }) => {
  const hooksDir = path.join(home, "dist", "hooks");
  if (!fs.existsSync(hooksDir)) {
    return {};
  }

  return fs
    .readdirSync(hooksDir)
    .sort()
    .map((name) => path.join(hooksDir, name))
    .filter((hookDir) => fs.existsSync(path.join(hookDir, HOOK_MANIFEST)))
    .reduce((collected, hookDir) => {
      const entries = readHookManifest(path.join(hookDir, HOOK_MANIFEST))[tool] ?? {};
      return appendHooks({ hooks: collected, added: resolveCommands({ entries, hookDir }) });
    }, {});
};

const isOurs = ({ hook, distDir }) =>
  typeof hook?.command === "string" && hook.command.includes(`${distDir}${path.sep}`);

const withoutOursInGroup = ({ group, distDir }) => {
  if (!Array.isArray(group?.hooks) || !group.hooks.some((hook) => isOurs({ hook, distDir }))) {
    return [group];
  }

  const kept = group.hooks.filter((hook) => !isOurs({ hook, distDir }));
  return kept.length === 0 ? [] : [{ ...group, hooks: kept }];
};

const withoutOurs = ({ hooks, distDir }) =>
  Object.fromEntries(
    Object.entries(hooks).flatMap(([event, groups]) => {
      if (!Array.isArray(groups)) {
        return [[event, groups]];
      }

      const kept = groups.flatMap((group) => withoutOursInGroup({ group, distDir }));
      return kept.length === 0 && groups.length > 0 ? [] : [[event, kept]];
    }),
  );

const countHooks = (hooks) =>
  Object.values(hooks)
    .flat()
    .reduce((total, group) => total + group.hooks.length, 0);

/**
 * Works out what installing one tool's built hooks into one of its config files
 * would write. Throws with a caller facing message when a file cannot be read.
 */
export const planHooks = ({ home, tool, configPath }) => {
  const built = collectBuiltHooks({ home, tool });
  const config = readConfig(configPath);
  const distDir = path.join(home, "dist");
  const existing = isObject(config.hooks) ? withoutOurs({ hooks: config.hooks, distDir }) : {};
  const hooks = appendHooks({ hooks: existing, added: built });
  const hasHooksKey = "hooks" in config || Object.keys(hooks).length > 0;
  const next = hasHooksKey ? { ...config, hooks } : config;

  return {
    text: `${JSON.stringify(next, null, 2)}\n`,
    isChanged: JSON.stringify(next) !== JSON.stringify(config),
    hookCount: countHooks(built),
  };
};

export const writeConfig = ({ configPath, text }) => {
  const realPath = fs.existsSync(configPath) ? fs.realpathSync(configPath) : configPath;
  const mode = fs.existsSync(realPath) ? fs.statSync(realPath).mode & 0o777 : 0o644;
  const temporary = `${realPath}.dotagents.tmp`;

  fs.mkdirSync(path.dirname(realPath), { recursive: true });
  fs.writeFileSync(temporary, text, "utf8");
  fs.chmodSync(temporary, mode);
  fs.renameSync(temporary, realPath);
};
