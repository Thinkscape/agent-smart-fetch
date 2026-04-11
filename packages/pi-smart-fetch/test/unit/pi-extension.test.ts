import { describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ExtensionAPI, initTheme } from "@mariozechner/pi-coding-agent";
import piSmartFetchExtension from "../../src/index";

interface RenderTheme {
  bold(value: string): string;
  fg(color: string, value: string): string;
  bg(color: string, value: string): string;
}

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
  renderCall?: (
    args: Record<string, unknown>,
    theme: RenderTheme,
    context?: unknown,
  ) => { render(width: number): string[] };
  renderResult?: (
    result: {
      content: Array<{ type: string; text: string }>;
      details?: Record<string, unknown>;
    },
    options: { expanded: boolean; isPartial?: boolean },
    theme: RenderTheme,
    context?: unknown,
  ) => { render(width: number): string[] };
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

const testTheme: RenderTheme = {
  bold: (value) => value,
  fg: (_color, value) => value,
  bg: (_color, value) => value,
};

initTheme("dark");

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

  it("renders web_fetch call header, compact collapsed result, and full output when expanded", () => {
    const registeredTool = findTool("web_fetch");
    expect(registeredTool.renderResult).toBeDefined();

    const callLines = registeredTool
      .renderCall?.({ url: "https://example.com/article" }, testTheme)
      .render(120);
    const callText = callLines?.join("\n") ?? "";
    expect(callText).toContain("web_fetch https://example.com/article");

    const result = {
      content: [
        {
          type: "text",
          text: [
            "> URL: https://example.com/article",
            "> Title: Example Article",
            "",
            "# Example Article",
            "Line 1",
            "Line 2",
            "Line 3",
            "Line 4",
            "Line 5",
            "Line 6",
            "Line 7",
            "Line 8",
            "Line 9",
          ].join("\n"),
        },
      ],
      details: {
        verbose: false,
        maxChars: 50000,
        fetchResult: {
          url: "https://example.com/article",
          finalUrl: "https://example.com/article",
          title: "Example Article",
          author: "",
          published: "",
          site: "Example",
          language: "en",
          wordCount: 321,
          content: [
            "# Example Article",
            "Line 1",
            "Line 2",
            "Line 3",
            "Line 4",
            "Line 5",
            "Line 6",
            "Line 7",
            "Line 8",
            "Line 9",
          ].join("\n"),
          browser: "chrome_145",
          os: "windows",
        },
      },
    };

    const collapsedLines = registeredTool
      .renderResult?.(result, { expanded: false }, testTheme)
      .render(120);
    const collapsedText = collapsedLines?.join("\n") ?? "";
    expect(collapsedText).toContain("> Title: Example Article");
    expect(collapsedText).toContain("# Example Article");
    expect(collapsedText).toContain("Line 6");
    expect(collapsedText).not.toContain("Line 8");
    expect(collapsedText).toContain("Ctrl+O to expand");
    expect(collapsedText).not.toContain("web_fetch Example Article");

    const expandedLines = registeredTool
      .renderResult?.(result, { expanded: true }, testTheme)
      .render(120);
    const expandedText = expandedLines?.join("\n") ?? "";
    expect(expandedText).toContain("# Example Article");
    expect(expandedText).toContain("Line 9");
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
