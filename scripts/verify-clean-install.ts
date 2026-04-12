#!/usr/bin/env bun

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "smart-fetch-clean-check-"));

function run(command: string, cwd?: string) {
  execSync(command, {
    stdio: "inherit",
    cwd,
    env: {
      ...process.env,
      CI: "true",
    },
  });
}

try {
  run(`git archive --format=tar HEAD | tar -xf - -C "${tempDir}"`);
  run("bun install --frozen-lockfile", tempDir);
  run("bun run typecheck", tempDir);
  console.log(`Clean-install verification passed in ${tempDir}`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
