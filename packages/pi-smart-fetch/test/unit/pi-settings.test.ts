import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadPiWebFetchSettings,
  resolvePiWebFetchSettings,
} from "../../src/settings";

describe("resolvePiWebFetchSettings", () => {
  it("uses project settings over global settings", () => {
    const resolved = resolvePiWebFetchSettings(
      {
        webFetchVerboseByDefault: true,
        webFetchDefaultMaxChars: 1200,
      },
      {
        webFetchVerboseByDefault: false,
        webFetchDefaultMaxChars: 300,
      },
    );

    expect(resolved).toEqual({
      verboseByDefault: false,
      defaultMaxChars: 300,
    });
  });

  it("ignores invalid values and falls back to defaults", () => {
    const resolved = resolvePiWebFetchSettings(
      {
        webFetchVerboseByDefault: "yes",
        webFetchDefaultMaxChars: -10,
      },
      {},
    );

    expect(resolved).toEqual({
      verboseByDefault: false,
      defaultMaxChars: undefined,
    });
  });
});

describe("loadPiWebFetchSettings", () => {
  it("reads global and project pi settings files", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "smart-fetch-pi-settings-"));
    const agentDir = join(baseDir, "agent");
    const cwd = join(baseDir, "project");

    await mkdir(agentDir, { recursive: true });
    await mkdir(join(cwd, ".pi"), { recursive: true });

    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify(
        {
          webFetchVerboseByDefault: true,
          webFetchDefaultMaxChars: 2000,
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify(
        {
          webFetchVerboseByDefault: false,
        },
        null,
        2,
      ),
    );

    expect(await loadPiWebFetchSettings(cwd, agentDir)).toEqual({
      verboseByDefault: false,
      defaultMaxChars: 2000,
    });
  });
});
