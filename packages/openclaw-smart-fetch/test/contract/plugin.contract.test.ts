import { describe, expect, it } from "bun:test";
import plugin from "../../src/index";
import type { ToolRegistrationApi } from "../../src/types";

function registerTools() {
  const tools: Array<Parameters<ToolRegistrationApi["registerTool"]>[0]> = [];

  plugin.register({
    registerTool(definition) {
      tools.push(definition);
    },
    logger: { info: () => {} },
  });

  return tools;
}

describe("plugin contract", () => {
  it("registers a smart_fetch tool with the expected schema surface", () => {
    const registeredTool = registerTools().find(
      (tool) => tool.name === "smart_fetch",
    );

    expect(registeredTool).toBeDefined();
    expect(registeredTool?.name).toBe("smart_fetch");
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
    expect(formatVariants).toEqual(["markdown", "html", "text", "json"]);
  });

  it("registers a batch_smart_fetch tool with a requests array of fetch items", () => {
    const registeredTool = registerTools().find(
      (tool) => tool.name === "batch_smart_fetch",
    );

    expect(registeredTool).toBeDefined();
    expect(registeredTool?.description).toContain("bounded concurrency");

    const schema = registeredTool?.parameters as {
      type?: string;
      required?: string[];
      properties?: Record<
        string,
        {
          type?: string;
          items?: {
            required?: string[];
            properties?: Record<string, { type?: string }>;
          };
        }
      >;
    };

    expect(schema.type).toBe("object");
    expect(schema.required).toContain("requests");
    expect(schema.properties?.requests?.type).toBe("array");
    expect(schema.properties?.requests?.items?.required).toContain("url");
    expect(schema.properties?.requests?.items?.properties?.url?.type).toBe(
      "string",
    );
  });

  it("returns an MCP-style error payload for invalid single-fetch input", async () => {
    const registeredTool = registerTools().find(
      (tool) => tool.name === "smart_fetch",
    );

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
