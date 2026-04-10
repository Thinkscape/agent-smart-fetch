#!/usr/bin/env bun

/**
 * Detect the latest Chrome profile in wreq-js and update source files if needed.
 * Run via: bun run detect-latest-chrome
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getProfiles } from "wreq-js";

const profiles = getProfiles();
const chromes = profiles.filter((p: string) => p.startsWith("chrome_")).sort();
const latest = chromes[chromes.length - 1];

console.log(`Latest Chrome profile: ${latest}`);
console.log(`Total profiles available: ${profiles.length}`);

// Read current default from extract.ts
const extractPath = join(import.meta.dir, "..", "src", "extract.ts");
const extractSrc = readFileSync(extractPath, "utf-8");
const currentMatch = extractSrc.match(
  /export const DEFAULT_BROWSER = "([^"]+)"/,
);
const current = currentMatch?.[1] ?? "unknown";

if (current === latest) {
  console.log(`✅ Already up to date: ${current}`);
  process.exit(0);
}

console.log(`🔄 Updating: ${current} → ${latest}`);

// Update extract.ts
const updatedExtract = extractSrc.replace(
  /export const DEFAULT_BROWSER = "[^"]+"/,
  `export const DEFAULT_BROWSER = "${latest}"`,
);
writeFileSync(extractPath, updatedExtract);
console.log("  Updated src/extract.ts");

// Update openclaw.plugin.json
const manifestPath = join(import.meta.dir, "..", "openclaw.plugin.json");
const manifest = readFileSync(manifestPath, "utf-8");
const updatedManifest = manifest.replace(
  /"default": "chrome_\d+"/,
  `"default": "${latest}"`,
);
writeFileSync(manifestPath, updatedManifest);
console.log("  Updated openclaw.plugin.json");

console.log("✅ Done. Run 'bun run test' to verify.");
