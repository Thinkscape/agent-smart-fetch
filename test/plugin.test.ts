import { describe, expect, it, mock } from "bun:test";
import plugin, { resolvePluginDefaults } from "../index";
import type { ToolRegistrationApi } from "../src/types";

describe("resolvePluginDefaults", () => {
  it("applies config overrides while preserving standard defaults", () => {
    expect(
      resolvePluginDefaults({
        browser: "firefox_147",
        maxChars: 1000,
        removeImages: true,
      }),
    ).toEqual({
      browser: "firefox_147",
      os: "windows",
      maxChars: 1000,
      timeoutMs: 15000,
      removeImages: true,
      includeReplies: "extractors",
    });
  });
});

describe("plugin registration", () => {
  it("registers the defuddle_fetch tool and logs the configured default profile", () => {
    let registeredTool: { name: string } | undefined;
    const api: ToolRegistrationApi = {
      pluginConfig: { browser: "firefox_147", os: "linux" },
      registerTool(definition) {
        registeredTool = definition;
      },
      logger: { info: mock(() => {}) },
    };

    plugin.register(api);

    expect(registeredTool?.name).toBe("defuddle_fetch");
    expect(api.logger.info).toHaveBeenCalledWith(
      "defuddle_fetch tool registered (default: firefox_147/linux)",
    );
  });

  it("surfaces invalid URL errors from the tool execution path", async () => {
    let registeredTool:
      | Parameters<ToolRegistrationApi["registerTool"]>[0]
      | undefined;

    const api: ToolRegistrationApi = {
      registerTool(definition) {
        registeredTool = definition;
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
});
