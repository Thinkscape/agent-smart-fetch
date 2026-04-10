import { describe, expect, it } from "bun:test";
import plugin from "../../index";
import type { ToolRegistrationApi } from "../../src/types";

describe("plugin contract", () => {
  it("registers a defuddle_fetch tool with the expected schema surface", () => {
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
    expect(registeredTool?.name).toBe("defuddle_fetch");
    expect(registeredTool?.description).toContain(
      "browser-grade TLS fingerprinting",
    );

    const schema = registeredTool?.parameters as {
      type?: string;
      required?: string[];
      properties?: Record<
        string,
        { anyOf?: Array<{ const?: string }>; type?: string }
      >;
    };

    expect(schema.type).toBe("object");
    expect(schema.required).toContain("url");
    expect(schema.properties?.url?.type).toBe("string");

    const formatVariants =
      schema.properties?.format?.anyOf?.map((variant) => variant.const) ?? [];
    expect(formatVariants).toEqual(["markdown", "html", "text"]);
  });

  it("returns an MCP-style error payload for invalid input", async () => {
    let registeredTool:
      | Parameters<ToolRegistrationApi["registerTool"]>[0]
      | undefined;

    plugin.register({
      registerTool(definition) {
        registeredTool = definition;
      },
      logger: { info: () => {} },
    });

    expect(registeredTool).toBeDefined();
    const response = await registeredTool?.execute("tool-call-1", {
      url: "not-a-url",
    });

    expect(response?.isError).toBe(true);
    expect(response?.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("Error: Invalid URL"),
      },
    ]);
  });
});
