#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getProfiles } from "wreq-js";

const profiles = getProfiles();
const chromes = profiles.filter((p: string) => p.startsWith("chrome_")).sort();
const latest = chromes[chromes.length - 1];

console.log(`Latest Chrome profile: ${latest}`);

const constantsPath = join(
  process.cwd(),
  "packages",
  "core",
  "src",
  "constants.ts",
);
const constants = readFileSync(constantsPath, "utf-8");
const updatedConstants = constants.replace(
  /export const DEFAULT_BROWSER = "[^"]+";/,
  `export const DEFAULT_BROWSER = "${latest}";`,
);
writeFileSync(constantsPath, updatedConstants);
console.log("Updated packages/core/src/constants.ts");

const manifestPath = join(
  process.cwd(),
  "packages",
  "openclaw-smart-fetch",
  "openclaw.plugin.json",
);
const manifest = readFileSync(manifestPath, "utf-8");
const updatedManifest = manifest.replace(
  /"default": "chrome_\d+"/,
  `"default": "${latest}"`,
);
writeFileSync(manifestPath, updatedManifest);
console.log("Updated packages/openclaw-smart-fetch/openclaw.plugin.json");
