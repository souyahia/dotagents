#!/usr/bin/env node
/**
 * Install one tool's built hooks into one of its config files, for install.sh.
 *
 *   install-hooks.mjs --home <directory> --tool <tool> --file <file> [--dry-run]
 *
 * Prints nothing when the file already holds the built hooks, like a link that
 * is already correct.
 */

import os from "node:os";
import path from "node:path";

import { HOOK_TOOLS, planHooks, writeConfig } from "./hooks.mjs";

const USAGE = "usage: install-hooks.mjs --home <directory> --tool <tool> --file <file> [--dry-run]";

const fail = (message) => {
  console.error(`error: ${message}`);
  process.exit(1);
};

const parseValue = (flag) => {
  const flagIndex = process.argv.indexOf(flag);
  if (flagIndex === -1 || flagIndex === process.argv.length - 1) {
    fail(USAGE);
  }

  return process.argv[flagIndex + 1];
};

const prettyPath = (target) =>
  target.startsWith(`${os.homedir()}${path.sep}`) ? `~${target.slice(os.homedir().length)}` : target;

const main = () => {
  const home = path.resolve(parseValue("--home"));
  const tool = parseValue("--tool");
  const configPath = path.resolve(parseValue("--file"));
  const isDryRun = process.argv.includes("--dry-run");
  const label = prettyPath(configPath);

  if (!HOOK_TOOLS.includes(tool)) {
    fail(`unknown tool '${tool}', expected ${HOOK_TOOLS.join(", ")}`);
  }

  const plan = (() => {
    try {
      return planHooks({ home, tool, configPath });
    } catch (error) {
      console.log(`  skip ${label}`);
      console.log(`       ${error.message}`);
      return null;
    }
  })();

  if (plan === null || !plan.isChanged) {
    return;
  }

  if (!isDryRun) {
    writeConfig({ configPath, text: plan.text });
  }

  const verb = isDryRun ? "would update" : "update";
  const noun = plan.hookCount === 1 ? "hook" : "hooks";
  console.log(`  ${verb} ${label}, ${plan.hookCount} ${noun} from dotagents`);
};

main();
