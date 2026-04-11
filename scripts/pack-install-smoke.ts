#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type NpmPackResult = {
  filename: string;
  name?: string;
  version?: string;
};

const packageDirs = process.argv.slice(2);
if (packageDirs.length === 0) {
  console.error(
    "Usage: bun run scripts/pack-install-smoke.ts <package-dir> [package-dir...]",
  );
  process.exit(1);
}

for (const packageDir of packageDirs) {
  const absPackageDir = path.resolve(packageDir);
  console.log(`\n==> Smoke testing packed install for ${packageDir}`);

  execFileSync("bun", ["run", "build"], {
    cwd: absPackageDir,
    stdio: "inherit",
  });

  const packJson = execFileSync("npm", ["pack", "--json"], {
    cwd: absPackageDir,
    encoding: "utf8",
  });
  const [packResult] = JSON.parse(packJson) as NpmPackResult[];
  if (!packResult?.filename) {
    throw new Error(`npm pack did not return a filename for ${packageDir}`);
  }

  const tarballPath = path.join(absPackageDir, packResult.filename);
  const extractDir = mkdtempSync(
    path.join(tmpdir(), "smart-fetch-pack-smoke-"),
  );

  try {
    execFileSync("tar", ["-xzf", tarballPath, "-C", extractDir], {
      stdio: "inherit",
    });

    execFileSync(
      "npm",
      ["install", "--omit=dev", "--silent", "--ignore-scripts"],
      {
        cwd: path.join(extractDir, "package"),
        stdio: "inherit",
      },
    );

    console.log(
      `✓ Packed install smoke test passed for ${packResult.name ?? packageDir}@${packResult.version ?? "unknown"}`,
    );
  } finally {
    if (existsSync(tarballPath)) {
      unlinkSync(tarballPath);
    }
    rmSync(extractDir, { recursive: true, force: true });
  }
}
