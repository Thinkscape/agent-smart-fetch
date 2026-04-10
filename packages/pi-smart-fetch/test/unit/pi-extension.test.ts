import { describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import piSmartFetchExtension from "../../src/index";

interface RegisteredPiTool {
  name: string;
  parameters: unknown;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: ((result: unknown) => void) | undefined,
    ctx: { cwd: string },
  ): Promise<{
    content: Array<{ type: string; text: string }>;
    details?: Record<string, unknown>;
  }>;
}

function registerPiTools() {
  const registeredTools: RegisteredPiTool[] = [];

  piSmartFetchExtension({
    registerTool(definition: unknown) {
      registeredTools.push(definition as RegisteredPiTool);
    },
  } as unknown as ExtensionAPI);

  expect(registeredTools.length).toBeGreaterThan(0);
  return registeredTools;
}

function findTool(name: string) {
  const tool = registerPiTools().find((candidate) => candidate.name === name);
  expect(tool).toBeDefined();
  return tool as RegisteredPiTool;
}

describe("pi extension", () => {
  it("registers a web_fetch tool with the OpenClaw-compatible parameter surface plus verbose", () => {
    const registeredTool = findTool("web_fetch");

    const schema = registeredTool.parameters as {
      required?: string[];
      properties?: Record<
        string,
        { type?: string; anyOf?: Array<{ const?: string }> }
      >;
    };

    expect(schema.required).toContain("url");
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining([
        "url",
        "browser",
        "os",
        "headers",
        "maxChars",
        "format",
        "removeImages",
        "includeReplies",
        "proxy",
        "verbose",
      ]),
    );

    const formatVariants =
      schema.properties?.format?.anyOf?.map((variant) => variant.const) ?? [];
    expect(formatVariants).toEqual(["markdown", "html", "text", "json"]);
  });

  it("registers a batch_web_fetch tool with a requests array and verbose option", () => {
    const registeredTool = findTool("batch_web_fetch");

    const schema = registeredTool.parameters as {
      required?: string[];
      properties?: Record<
        string,
        {
          type?: string;
          items?: {
            required?: string[];
            properties?: Record<string, unknown>;
          };
        }
      >;
    };

    expect(schema.required).toContain("requests");
    expect(schema.properties?.requests?.type).toBe("array");
    expect(schema.properties?.requests?.items?.required).toContain("url");
    expect(schema.properties?.verbose?.type).toBe("boolean");
  });

  it("surfaces invalid URL errors from the pi single-fetch execution path", async () => {
    const registeredTool = findTool("web_fetch");
    const cwd = await mkdtemp(join(tmpdir(), "smart-fetch-pi-extension-"));
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({ smartFetchVerboseByDefault: false }, null, 2),
    );

    const response = await registeredTool.execute(
      "tool-call-1",
      { url: "not-a-url" },
      undefined,
      undefined,
      { cwd },
    );

    expect(response.content[0]?.text).toContain("Error: Invalid URL");
    expect(response.details).toEqual({ error: true, verbose: false });
  });

  it("returns labeled per-item results and streams progress updates for batch_web_fetch", async () => {
    const registeredTool = findTool("batch_web_fetch");
    const cwd = await mkdtemp(
      join(tmpdir(), "smart-fetch-pi-batch-extension-"),
    );
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify(
        {
          smartFetchVerboseByDefault: false,
          smartFetchDefaultBatchConcurrency: 4,
        },
        null,
        2,
      ),
    );

    const onUpdate = mock((_result: unknown) => {});
    const response = await registeredTool.execute(
      "tool-call-2",
      { requests: [{ url: "not-a-url" }] },
      undefined,
      onUpdate,
      { cwd },
    );

    expect(onUpdate).toHaveBeenCalled();
    expect(response.content[0]?.text).toContain("> Requests: 1");
    expect(response.content[0]?.text).toContain("## [1/1] not-a-url");
    expect(response.content[0]?.text).toContain(
      "> Error: Invalid URL: not-a-url",
    );
    expect(response.details?.batchResult).toBeDefined();
    expect(response.details?.batchProgress).toBeDefined();
  });
});
