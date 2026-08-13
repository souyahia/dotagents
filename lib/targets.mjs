#!/usr/bin/env node
/**
 * Print the install targets declared in targets.json, for install.sh to read.
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
 * The reading itself lives in resolve-targets.mjs, because build.mjs needs the
 * same answer to tell you when a built skill is not linked anywhere.
 */

import path from "node:path";

import { resolveTargets } from "./resolve-targets.mjs";

const fail = (message) => {
  console.error(`error: ${message}`);
  process.exit(1);
};

const parseHome = () => {
  const flagIndex = process.argv.indexOf("--home");
  if (flagIndex === -1 || flagIndex === process.argv.length - 1) {
    fail("usage: targets.mjs --home <directory>");
  }

  return path.resolve(process.argv[flagIndex + 1]);
};

const main = () => {
  const home = parseHome();

  const targets = (() => {
    try {
      return resolveTargets({ home });
    } catch (error) {
      return fail(error.message);
    }
  })();

  for (const target of targets) {
    console.log(`${target.kind}\t${target.path}`);
  }
};

main();
