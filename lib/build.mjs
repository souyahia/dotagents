#!/usr/bin/env node
/**
 * Render a dotagents source tree into dist/.
 *
 * Source layout (under DOTAGENTS_HOME):
 *
 *   src/instructions.md                shared agent instructions
 *   src/vars.default.json              declares every known variable
 *   src/skills/<name>/SKILL.md         shared skills
 *   src/machines/<id>/vars.json        per machine variable overrides
 *   src/machines/<id>/instructions.md  appended to the shared instructions
 *   src/machines/<id>/skills/          machine only skills, override by name
 *   vars.local.json                    gitignored overrides and secrets
 *   .machine                           gitignored machine identity
 *
 * Variables are written as {{UPPER_SNAKE}} and substituted in .md and .txt
 * files. A reference with no value is a build error, never a silent empty
 * string. Write {{!NAME}} to emit a literal {{NAME}} without substituting it.
 *
 * Writes nothing outside DOTAGENTS_HOME. It does read the install targets to
 * warn about skills that are built but linked nowhere; pass --no-link-check to
 * skip that, which install.sh does because it is about to create the links.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveTargets } from "./resolve-targets.mjs";

const VAR_PATTERN = /\{\{\s*(!?)\s*([A-Z][A-Z0-9_]*)\s*\}\}/g;
const NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const RENDERED_SUFFIXES = new Set([".md", ".txt"]);
const SKILL_ENTRYPOINT = "SKILL.md";

const DEFAULT_VARS_LAYER = "src/vars.default.json";
const LOCAL_VARS_LAYER = "vars.local.json";
const LINK_CHECK_FLAG = "--no-link-check";

const fail = (message) => {
  console.error(`error: ${message}`);
  process.exit(1);
};

const warn = (message) => {
  console.error(`warning: ${message}`);
};

const isDirectory = (target) => fs.existsSync(target) && fs.statSync(target).isDirectory();

const isFile = (target) => fs.existsSync(target) && fs.statSync(target).isFile();

const parseHome = () => {
  const flagIndex = process.argv.indexOf("--home");
  if (flagIndex === -1 || flagIndex === process.argv.length - 1) {
    fail("usage: build.mjs --home <directory>");
  }

  return path.resolve(process.argv[flagIndex + 1]);
};

/** Returns the machine id and where it came from. */
const resolveMachine = (home) => {
  const fromEnvironment = (process.env.DOTAGENTS_MACHINE ?? "").trim();
  if (fromEnvironment) {
    return { machine: fromEnvironment, source: "DOTAGENTS_MACHINE" };
  }

  const machineFile = path.join(home, ".machine");
  if (isFile(machineFile)) {
    const fromFile = fs.readFileSync(machineFile, "utf8").trim();
    if (fromFile) {
      return { machine: fromFile, source: ".machine" };
    }
  }

  return { machine: os.hostname().split(".")[0], source: "hostname" };
};

const readVarsFile = (filePath) => {
  const parsed = (() => {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      return fail(`${filePath} could not be read as JSON: ${error.message}`);
    }
  })();

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`${filePath} must contain a JSON object`);
  }

  for (const [name, value] of Object.entries(parsed)) {
    if (!NAME_PATTERN.test(name)) {
      fail(`${filePath} declares '${name}', but names must be UPPER_SNAKE_CASE`);
    }
    if (typeof value !== "string") {
      fail(`${filePath} sets '${name}' to a ${typeof value}, but every value must be a string`);
    }
  }

  return parsed;
};

/** Merges the variable layers. Returns the merged map and each name's origin. */
const loadVariables = ({ home, machineDir }) => {
  const layers = [{ label: DEFAULT_VARS_LAYER, filePath: path.join(home, DEFAULT_VARS_LAYER) }];

  if (machineDir !== null) {
    layers.push({
      label: `src/machines/${path.basename(machineDir)}/vars.json`,
      filePath: path.join(machineDir, "vars.json"),
    });
  }

  layers.push({ label: LOCAL_VARS_LAYER, filePath: path.join(home, LOCAL_VARS_LAYER) });

  const variables = {};
  const origins = {};

  for (const { label, filePath } of layers) {
    if (!isFile(filePath)) {
      continue;
    }
    for (const [name, value] of Object.entries(readVarsFile(filePath))) {
      variables[name] = value;
      origins[name] = label;
    }
  }

  return { variables, origins };
};

/** Shared skills, then machine skills overriding them by name. */
const collectSkills = ({ src, machineDir }) => {
  const sources = [{ skillsDir: path.join(src, "skills"), layer: "shared" }];
  if (machineDir !== null) {
    sources.push({ skillsDir: path.join(machineDir, "skills"), layer: "machine" });
  }

  const collected = new Map();

  for (const { skillsDir, layer } of sources) {
    if (!isDirectory(skillsDir)) {
      continue;
    }

    const names = fs.readdirSync(skillsDir).sort();
    for (const name of names) {
      const skillDir = path.join(skillsDir, name);
      if (name.startsWith(".") || !isDirectory(skillDir)) {
        continue;
      }
      if (!isFile(path.join(skillDir, SKILL_ENTRYPOINT))) {
        fail(`${skillDir} has no ${SKILL_ENTRYPOINT}, so it is not a valid skill`);
      }
      collected.set(name, { skillDir, layer });
    }
  }

  return collected;
};

const decodeUtf8 = (buffer) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
};

/** Substitutes variables while recording which were used and which are missing. */
const createRenderer = (variables) => {
  const used = new Set();
  const missing = [];

  const render = ({ text, origin }) =>
    text.replace(VAR_PATTERN, (match, escapeMark, name, offset) => {
      if (escapeMark === "!") {
        return `{{${name}}}`;
      }
      if (name in variables) {
        used.add(name);
        return variables[name];
      }

      const line = text.slice(0, offset).split("\n").length;
      missing.push({ origin, line, name });
      return match;
    });

  return { render, used, missing };
};

const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return [{ full, isDir: true }, ...walk(full)];
      }
      return [{ full, isDir: false }];
    });

const renderTree = ({ renderer, sourceDir, targetDir }) => {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const { full, isDir } of walk(sourceDir)) {
    const destination = path.join(targetDir, path.relative(sourceDir, full));

    if (isDir) {
      fs.mkdirSync(destination, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(destination), { recursive: true });

    const mode = fs.statSync(full).mode;
    if (!RENDERED_SUFFIXES.has(path.extname(full).toLowerCase())) {
      fs.copyFileSync(full, destination);
      fs.chmodSync(destination, mode);
      continue;
    }

    const text = decodeUtf8(fs.readFileSync(full));
    if (text === null) {
      fs.copyFileSync(full, destination);
      fs.chmodSync(destination, mode);
      continue;
    }

    fs.writeFileSync(destination, renderer.render({ text, origin: full }), "utf8");
    fs.chmodSync(destination, mode);
  }
};

const buildInstructions = ({ renderer, src, machineDir, staging }) => {
  const shared = path.join(src, "instructions.md");
  const fragment = machineDir === null ? null : path.join(machineDir, "instructions.md");

  const sections = [shared, fragment]
    .filter((candidate) => candidate !== null && isFile(candidate))
    .map((candidate) =>
      renderer.render({ text: fs.readFileSync(candidate, "utf8"), origin: candidate }).trimEnd(),
    );

  if (sections.length === 0) {
    return false;
  }

  fs.writeFileSync(path.join(staging, "instructions.md"), `${sections.join("\n\n")}\n`, "utf8");
  return true;
};

const reportMissing = ({ missing, home }) => {
  console.error("error: undefined variables referenced in the source tree");
  for (const { origin, line, name } of missing) {
    console.error(`  ${path.relative(home, origin)}:${line}: {{${name}}}`);
  }
  console.error(
    `\nDefine them in ${DEFAULT_VARS_LAYER}, in the machine's vars.json, or in ${LOCAL_VARS_LAYER}.`,
  );
  process.exit(1);
};

/**
 * Names the built skills that some skills target has no link for.
 *
 * Each target holds one symlink per skill rather than a link to the skills
 * directory, so an added skill reaches no agent until install runs, however
 * many times it is rebuilt. Only reads, and treats an unreadable targets.json
 * as nothing to check, because a convenience warning must not fail a build.
 */
const findUnlinkedSkills = ({ home, skillNames }) => {
  const targets = (() => {
    try {
      return resolveTargets({ home }).filter(({ kind }) => kind === "skills");
    } catch {
      return [];
    }
  })();

  const dist = path.join(home, "dist");
  const unlinked = new Set();

  for (const target of targets) {
    for (const name of skillNames) {
      const link = (() => {
        try {
          return fs.readlinkSync(path.join(target.path, name));
        } catch {
          return null;
        }
      })();

      if (link !== path.join(dist, "skills", name)) {
        unlinked.add(name);
      }
    }
  }

  return [...unlinked].sort();
};

const reportUnlinked = (unlinked) => {
  if (unlinked.length === 0) {
    return;
  }

  const shown = unlinked.slice(0, 3).join(", ");
  const rest = unlinked.length > 3 ? `, and ${unlinked.length - 3} more` : "";
  const subject = unlinked.length === 1 ? "1 built skill is" : `${unlinked.length} built skills are`;

  warn(`${subject} not linked into your agent config: ${shown}${rest}`);
  console.error("  run ./install.sh to create the missing links");
};

const main = () => {
  const home = parseHome();
  const src = path.join(home, "src");
  if (!isDirectory(src)) {
    fail(`no src/ directory under ${home}`);
  }

  const { machine, source } = resolveMachine(home);
  const candidateDir = path.join(src, "machines", machine);
  const hasMachineDir = isDirectory(candidateDir);

  if (!hasMachineDir && source !== "hostname") {
    fail(`${source} names machine '${machine}', but src/machines/${machine}/ does not exist`);
  }

  const machineDir = hasMachineDir ? candidateDir : null;
  const { variables, origins } = loadVariables({ home, machineDir });
  const skills = collectSkills({ src, machineDir });

  const staging = path.join(home, ".dist.tmp");
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  const renderer = createRenderer(variables);

  for (const [name, { skillDir }] of skills) {
    renderTree({ renderer, sourceDir: skillDir, targetDir: path.join(staging, "skills", name) });
  }

  const hasInstructions = buildInstructions({ renderer, src, machineDir, staging });

  if (renderer.missing.length > 0) {
    fs.rmSync(staging, { recursive: true, force: true });
    reportMissing({ missing: renderer.missing, home });
  }

  const dist = path.join(home, "dist");
  fs.rmSync(dist, { recursive: true, force: true });
  fs.renameSync(staging, dist);

  const overridden = [...skills.values()].filter(({ layer }) => layer === "machine");
  const machineLabel = machineDir === null ? `${machine} (no machine layer)` : machine;
  const overriddenLabel = overridden.length > 0 ? `, ${overridden.length} from the machine layer` : "";

  console.log(`machine:      ${machineLabel} (from ${source})`);
  console.log(`skills:       ${skills.size} built${overriddenLabel}`);
  console.log(`instructions: ${hasInstructions ? "built" : "none"}`);
  console.log(`output:       ${dist}`);

  for (const name of Object.keys(origins).sort()) {
    if (origins[name] === DEFAULT_VARS_LAYER || renderer.used.has(name)) {
      continue;
    }
    warn(`'${name}' is set in ${origins[name]} but no source file references it`);
  }

  if (!process.argv.includes(LINK_CHECK_FLAG)) {
    reportUnlinked(findUnlinkedSkills({ home, skillNames: [...skills.keys()] }));
  }
};

main();
