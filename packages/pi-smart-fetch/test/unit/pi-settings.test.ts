import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadPiSmartFetchSettings,
  resolvePiSmartFetchSettings,
} from "../../src/settings";

describe("resolvePiSmartFetchSettings", () => {
  it("uses project settings over global settings for all supported defaults", () => {
    const resolved = resolvePiSmartFetchSettings(
      {
        smartFetchVerboseByDefault: true,
        smartFetchDefaultMaxChars: 1200,
        smartFetchDefaultTimeoutMs: 15000,
        smartFetchDefaultBrowser: "chrome_145",
        smartFetchDefaultOs: "windows",
        smartFetchDefaultRemoveImages: false,
        smartFetchDefaultIncludeReplies: "extractors",
      },
      {
        smartFetchVerboseByDefault: false,
        smartFetchDefaultMaxChars: 300,
        smartFetchDefaultTimeoutMs: 5000,
        smartFetchDefaultBrowser: "firefox_147",
        smartFetchDefaultOs: "linux",
        smartFetchDefaultRemoveImages: true,
        smartFetchDefaultIncludeReplies: true,
      },
    );

    expect(resolved).toEqual({
      verboseByDefault: false,
      maxChars: 300,
      timeoutMs: 5000,
      browser: "firefox_147",
      os: "linux",
      removeImages: true,
      includeReplies: true,
    });
  });

  it("ignores invalid values and falls back to defaults", () => {
    const resolved = resolvePiSmartFetchSettings(
      {
        smartFetchVerboseByDefault: "yes",
        smartFetchDefaultMaxChars: -10,
        smartFetchDefaultTimeoutMs: 0,
        smartFetchDefaultBrowser: "",
        smartFetchDefaultOs: "beos",
        smartFetchDefaultRemoveImages: "no",
        smartFetchDefaultIncludeReplies: "all",
      },
      {},
    );

    expect(resolved).toEqual({
      verboseByDefault: false,
      maxChars: undefined,
      timeoutMs: undefined,
      browser: undefined,
      os: undefined,
      removeImages: undefined,
      includeReplies: undefined,
    });
  });

  it("accepts legacy webFetch settings as a fallback alias", () => {
    const resolved = resolvePiSmartFetchSettings(
      {
        webFetchVerboseByDefault: true,
        webFetchDefaultMaxChars: 2000,
      },
      {},
    );

    expect(resolved).toEqual({
      verboseByDefault: true,
      maxChars: 2000,
      timeoutMs: undefined,
      browser: undefined,
      os: undefined,
      removeImages: undefined,
      includeReplies: undefined,
    });
  });
});

describe("loadPiSmartFetchSettings", () => {
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
          smartFetchVerboseByDefault: true,
          smartFetchDefaultMaxChars: 2000,
          smartFetchDefaultTimeoutMs: 9000,
          smartFetchDefaultBrowser: "chrome_145",
          smartFetchDefaultOs: "windows",
          smartFetchDefaultRemoveImages: false,
          smartFetchDefaultIncludeReplies: "extractors",
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify(
        {
          smartFetchVerboseByDefault: false,
          smartFetchDefaultBrowser: "firefox_147",
          smartFetchDefaultRemoveImages: true,
        },
        null,
        2,
      ),
    );

    expect(await loadPiSmartFetchSettings(cwd, agentDir)).toEqual({
      verboseByDefault: false,
      maxChars: 2000,
      timeoutMs: 9000,
      browser: "firefox_147",
      os: "windows",
      removeImages: true,
      includeReplies: "extractors",
    });
  });
});
