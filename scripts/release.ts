#!/usr/bin/env bun

import { execSync } from "node:child_process";

type ReleaseKind = "patch" | "minor" | "major";
const kind = (process.argv[2] as ReleaseKind | undefined) ?? "patch";
if (!["patch", "minor", "major"].includes(kind)) {
  console.error("Usage: bun run scripts/release.ts [patch|minor|major]");
  process.exit(1);
}

function run(command: string) {
  execSync(command, { stdio: "inherit" });
}

run("bun run check");
run(`bun run scripts/version.ts ${kind}`);
run("bun run format");

const version = execSync("node -p \"require('./package.json').version\"", {
  encoding: "utf8",
}).trim();

run("git add -A");
run(`git commit -m "chore: release v${version}"`);
run(`git tag -a "v${version}" -m "Release v${version}"`);
