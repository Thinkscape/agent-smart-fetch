#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type ReleaseKind = "patch" | "minor" | "major";

type PackageJson = {
  version?: string;
  dependencies?: Record<string, string>;
};

const kind = process.argv[2] as ReleaseKind | undefined;
if (!kind || !["patch", "minor", "major"].includes(kind)) {
  console.error("Usage: bun run scripts/version.ts <patch|minor|major>");
  process.exit(1);
}

const packagePaths = [
  "package.json",
  "packages/core/package.json",
  "packages/pi-smart-fetch/package.json",
  "packages/openclaw-smart-fetch/package.json",
];

function bump(version: string, release: ReleaseKind) {
  const [major, minor, patch] = version.split(".").map(Number);
  if ([major, minor, patch].some((value) => Number.isNaN(value))) {
    throw new Error(`Invalid semver: ${version}`);
  }
  if (release === "major") return `${major + 1}.0.0`;
  if (release === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const rootPackagePath = join(process.cwd(), "package.json");
const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf-8")) as {
  version: string;
};
const nextVersion = bump(rootPackage.version, kind);

for (const relativePath of packagePaths) {
  const path = join(process.cwd(), relativePath);
  const pkg = JSON.parse(readFileSync(path, "utf-8")) as PackageJson;
  pkg.version = nextVersion;

  if (pkg.dependencies?.["smart-fetch-core"]) {
    pkg.dependencies["smart-fetch-core"] = nextVersion;
  }

  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`Updated ${relativePath} -> ${nextVersion}`);
}

const openClawManifestPath = join(
  process.cwd(),
  "packages",
  "openclaw-smart-fetch",
  "openclaw.plugin.json",
);
const openClawManifest = readFileSync(openClawManifestPath, "utf-8");
writeFileSync(
  openClawManifestPath,
  `${openClawManifest.replace(
    /"version":\s*"[^"]+"/,
    `"version": "${nextVersion}"`,
  )}\n`,
);
console.log(
  `Updated packages/openclaw-smart-fetch/openclaw.plugin.json -> ${nextVersion}`,
);
