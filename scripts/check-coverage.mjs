#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const threshold = "100";

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function distTestFiles() {
  const testsDir = join(root, "dist", "tests");
  return readdirSync(testsDir)
    .filter((name) => name.endsWith(".test.js"))
    .sort()
    .map((name) => join(testsDir, name));
}

console.log("Building before coverage...");
run("npm", ["run", "build"]);

const tests = distTestFiles();
if (tests.length === 0) {
  console.error("No compiled test files found in dist/tests/*.test.js");
  process.exit(1);
}

console.log(`Running coverage with ${threshold}% thresholds for lines, branches, and functions...`);
run(process.execPath, [
  "--test",
  "--experimental-test-coverage",
  `--test-coverage-lines=${threshold}`,
  `--test-coverage-branches=${threshold}`,
  `--test-coverage-functions=${threshold}`,
  ...tests,
]);
