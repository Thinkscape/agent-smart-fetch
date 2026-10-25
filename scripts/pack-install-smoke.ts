#!/usr/bin/env bun

import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

type NpmPackResult = {
  filename: string;
  name?: string;
  version?: string;
};

type NpmPackJson = NpmPackResult[] | Record<string, NpmPackResult>;

/**
 * Runs the installed CLI against a local page larger than --max-response-bytes,
 * which exercises the bundled HTML-analysis worker from the packed layout.
 */
async function smokeTestCli(installedRoot: string, binPath: string) {
  const page = `<html><head><title>Smoke test page</title></head><body><article><h1>Smoke test page</h1>${"<p>Packed installs must ship the extraction worker next to the bundle.</p>".repeat(1_000)}</article></body></html>`;
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(page);
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;

  try {
    const child = spawn(
      process.execPath,
      [
        path.join(installedRoot, binPath),
        "--max-response-bytes",
        "16384",
        "--max-chars",
        "500",
        `http://127.0.0.1:${port}/`,
      ],
      { cwd: installedRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const exitCode = await new Promise<number | null>((resolve) =>
      child.on("close", resolve),
    );
    if (
      exitCode !== 0 ||
      !output.includes("Smoke test page") ||
      !output.includes("> Truncated:")
    ) {
      throw new Error(
        `Packed CLI did not extract a truncated page (exit ${exitCode}):\n${output}`,
      );
    }
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

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
  const parsedPackJson = JSON.parse(packJson) as NpmPackJson;
  const packResults = Array.isArray(parsedPackJson)
    ? parsedPackJson
    : Object.values(parsedPackJson);
  const [packResult] = packResults;
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

    const installedRoot = path.join(extractDir, "package");
    execFileSync(
      "npm",
      ["install", "--omit=dev", "--silent", "--ignore-scripts"],
      {
        cwd: installedRoot,
        stdio: "inherit",
      },
    );

    // smart-fetch-core starts HTML extraction from this sibling of the bundle.
    if (!existsSync(path.join(installedRoot, "dist/html-analysis-worker.js"))) {
      throw new Error(
        `${packageDir} was packed without dist/html-analysis-worker.js`,
      );
    }
    const manifest = JSON.parse(
      readFileSync(path.join(installedRoot, "package.json"), "utf8"),
    ) as { bin?: Record<string, string> };
    const [binPath] = Object.values(manifest.bin ?? {});
    if (binPath) {
      await smokeTestCli(installedRoot, binPath);
    }

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
