#!/usr/bin/env node
/**
 * `next` is declared twice on purpose, and this keeps the two honest.
 *
 * The root declaration exists only so AWS Amplify's WEB_COMPUTE platform
 * detection finds Next at the repo root — see the "//next" note in the root
 * package.json. The frontend declaration is the real one.
 *
 * The single workspace lockfile already guarantees both resolve to the same
 * installed package. What it can't prevent is someone bumping one manifest and
 * not the other, leaving Amplify to detect one version and build with another.
 * That's what this catches, and it's why it runs first in `npm run check`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const read = (path) => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));

const rootPin = read("package.json").dependencies?.next;
const frontendPin = read("frontend/package.json").dependencies?.next;

if (!rootPin) {
  console.error("✖ package.json has no `next` dependency. Amplify's WEB_COMPUTE detection needs it at the repo root.");
  process.exit(1);
}

if (rootPin !== frontendPin) {
  console.error(`✖ next pin mismatch: root is ${rootPin}, frontend/package.json is ${frontendPin}.`);
  console.error("  Amplify detects the root version and builds with the frontend one. Make them equal.");
  process.exit(1);
}

console.log(`✔ next pinned consistently at ${rootPin}`);
