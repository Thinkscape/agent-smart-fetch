import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

describe("cli", () => {
  test("placeholder", () => {
    expect(true).toBe(true);
  });
});

describe("cli --max-response-bytes", () => {
  const page = `<html><head><title>Long page</title></head><body><article><h1>Long page</h1><p>EarlyMarker starts here.</p>${"<p>Plenty of ordinary prose fills the middle of this long page.</p>".repeat(3_000)}<p>LateMarker ends here.</p></article></body></html>`;
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(page);
  });
  const listening = new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  test(
    "limits how much of the response body is read",
    async () => {
      await listening;
      const { port } = server.address() as AddressInfo;
      const child = spawn(
        process.execPath,
        [
          join(import.meta.dir, "..", "src", "cli.ts"),
          "--max-response-bytes",
          "16384",
          "--max-chars",
          "10000000",
          `http://127.0.0.1:${port}/long`,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const exitCode = await new Promise<number | null>((resolve) =>
        child.on("close", resolve),
      );

      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(stdout).toContain("EarlyMarker");
      expect(stdout).not.toContain("LateMarker");
      expect(stdout).toContain("> Truncated: read the first 16.0 KB of ");
    },
    { timeout: 30_000 },
  );
});
