import { describe, expect, it, mock } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin, { resolvePluginDefaults } from "../src/index";
import type { ToolRegistrationApi } from "../src/types";

describe("resolvePluginDefaults", () => {
  it("applies config overrides while preserving standard defaults", () => {
    expect(
      resolvePluginDefaults({
        browser: "firefox_147",
        maxChars: 1000,
        removeImages: true,
        batchConcurrency: 3,
      }),
    ).toEqual({
      browser: "firefox_147",
      os: "windows",
      maxChars: 1000,
      timeoutMs: 15000,
      removeImages: true,
      includeReplies: "extractors",
      batchConcurrency: 3,
      tempDir: join(tmpdir(), "smart-fetch-openclaw"),
    });
  });
});

describe("plugin registration", () => {
  it("registers smart_fetch and batch_smart_fetch tools", () => {
    const registeredTools: Array<{ name: string }> = [];
    const api: ToolRegistrationApi = {
      pluginConfig: {
        browser: "firefox_147",
        os: "linux",
        batchConcurrency: 6,
      },
      registerTool(definition) {
        registeredTools.push(definition);
      },
      logger: { info: mock(() => {}) },
    };

    plugin.register(api);

    expect(registeredTools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["smart_fetch", "batch_smart_fetch"]),
    );
    expect(api.logger.info).not.toHaveBeenCalled();
  });

  it("surfaces invalid URL errors from the smart_fetch execution path", async () => {
    let registeredTool:
      | Parameters<ToolRegistrationApi["registerTool"]>[0]
      | undefined;

    const api: ToolRegistrationApi = {
      registerTool(definition) {
        if (definition.name === "smart_fetch") {
          registeredTool = definition;
        }
      },
      logger: { info: () => {} },
    };

    plugin.register(api);

    expect(registeredTool).toBeDefined();
    const response = await registeredTool?.execute("tool-call-1", {
      url: "not-a-url",
    });

    expect(response?.isError).toBe(true);
    expect(response?.content[0]?.text).toContain("Invalid URL");
  });

  it("returns labeled per-item results from batch_smart_fetch", async () => {
    let registeredTool:
      | Parameters<ToolRegistrationApi["registerTool"]>[0]
      | undefined;

    const api: ToolRegistrationApi = {
      registerTool(definition) {
        if (definition.name === "batch_smart_fetch") {
          registeredTool = definition;
        }
      },
      logger: { info: () => {} },
    };

    plugin.register(api);

    expect(registeredTool).toBeDefined();
    const response = await registeredTool?.execute("tool-call-2", {
      requests: [{ url: "not-a-url" }],
    });

    expect(response?.isError).toBeUndefined();
    expect(response?.content[0]?.text).toContain("> Requests: 1");
    expect(response?.content[0]?.text).toContain("## [1/1] not-a-url");
    expect(response?.content[0]?.text).toContain(
      "> Error: Invalid URL: not-a-url",
    );
  });
});
