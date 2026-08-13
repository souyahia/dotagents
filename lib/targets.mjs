#!/usr/bin/env node
/**
 * Resolve the install targets declared in targets.json.
 *
 * Prints one tab separated row per declared target:
 *
 *   <kind><TAB><absolute path>
 *
 * `kind` is "skills" for a directory that receives one symlink per built skill,
 * or "instructions" for a single symlink to the rendered instructions file.
 * Every declared target is installed, and its directories are created if
 * missing.
 *
 * targets.local.json, when present, replaces targets.json entirely. Use it for a
 * machine whose layout differs from the one you commit.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const KINDS = ["skills", "instructions"];
const SHARED_FILE = "targets.json";
const LOCAL_FILE = "targets.local.json";

const fail = (message) => {
  console.error(`error: ${message}`);
  process.exit(1);
};

const isFile = (target) => fs.existsSync(target) && fs.statSync(target).isFile();

const parseHome = () => {
  const flagIndex = process.argv.indexOf("--home");
  if (flagIndex === -1 || flagIndex === process.argv.length - 1) {
    fail("usage: targets.mjs --home <directory>");
  }

  return path.resolve(process.argv[flagIndex + 1]);
};

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

const main = () => {
  const home = parseHome();

  const localPath = path.join(home, LOCAL_FILE);
  const sharedPath = path.join(home, SHARED_FILE);
  const source = isFile(localPath) ? localPath : sharedPath;

  if (!isFile(source)) {
    fail(`no ${SHARED_FILE} found in ${home}, so there is nowhere to install`);
  }

  const parsed = (() => {
    try {
      return JSON.parse(fs.readFileSync(source, "utf8"));
    } catch (error) {
      return fail(`${source} could not be read as JSON: ${error.message}`);
    }
  })();

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`${source} must contain a JSON object`);
  }

  const unknown = Object.keys(parsed).filter((key) => !KINDS.includes(key));
  if (unknown.length > 0) {
    fail(`${source}: unknown key(s) ${unknown.sort().join(", ")}, expected ${KINDS.join(" and ")}`);
  }

  for (const kind of KINDS) {
    const entries = parsed[kind] ?? [];
    if (!Array.isArray(entries)) {
      fail(`${source}: '${kind}' must be a list`);
    }

    for (const entry of entries) {
      if (typeof entry !== "string" || entry === "") {
        fail(`${source}: every '${kind}' entry must be a non empty path string`);
      }
      console.log(`${kind}\t${expand(entry)}`);
    }
  }
};

main();
