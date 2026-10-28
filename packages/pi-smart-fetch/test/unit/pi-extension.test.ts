import { describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ExtensionAPI, initTheme } from "@earendil-works/pi-coding-agent";
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

const taggedTheme: RenderTheme = {
  bold: (value) => value,
  fg: (color, value) => `<${color}>${value}</${color}>`,
  bg: (color, value) => `<bg:${color}>${value}</bg:${color}>`,
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
    expect(formatVariants).toEqual(["markdown", "html", "text", "json", "raw"]);
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
    expect(response.details).toMatchObject({
      error: true,
      verbose: false,
      userErrorSummary: "That URL is invalid.",
    });
    expect((response.details as Record<string, unknown>).errorText).toEqual(
      expect.stringContaining("Error: Invalid URL: not-a-url"),
    );
  });

  it("renders web_fetch call header and a compact result summary without page content", () => {
    const registeredTool = findTool("web_fetch");
    expect(registeredTool.renderResult).toBeDefined();

    const callLines = registeredTool
      .renderCall?.({ url: "https://example.com/article" }, testTheme)
      .render(120);
    const callText = callLines?.join("\n") ?? "";
    expect(callText).toContain("web_fetch https://example.com/article");

    const pageLines = [
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
    ];
    const pageContent = pageLines.join("\n");

    const result = {
      content: [
        {
          type: "text",
          text: [
            "> URL: https://example.com/article",
            "> Title: Example Article",
            "> Published: 2026-04-10",
            "> Author: Ada Lovelace",
            "> Site: Example",
            "> Language: en",
            "> Words: 321",
            "> Browser: chrome_145/windows",
            "",
            pageContent,
          ].join("\n"),
        },
      ],
      details: {
        verbose: false,
        format: "markdown",
        maxChars: 50000,
        fetchSummary: {
          kind: "content",
          url: "https://example.com/article",
          finalUrl: "https://example.com/article",
          ok: true,
          charCount: pageContent.length,
          wordCount: 321,
          truncated: false,
          title: "Example Article",
          published: "2026-04-10",
        },
      },
    };

    // Collapsed and expanded views intentionally render the same compact
    // summary; page text stays in the agent-facing content payload.
    for (const expanded of [false, true] as const) {
      const lines = registeredTool
        .renderResult?.(result, { expanded }, testTheme)
        .render(120);
      const text = lines?.join("\n") ?? "";

      expect(text).toContain("Title: Example Article");
      expect(text).toContain("Published: 2026-04-10");
      expect(text).toContain(`${pageContent.length} chars · 321 words`);

      // No page content and no expand hint in the TUI view.
      expect(text).not.toContain("Line 1");
      expect(text).not.toContain("# Example Article");
      expect(text).not.toContain("Ctrl+O");
    }
  });

  it("renders user-facing metadata with YAML-like key and string colors", () => {
    const registeredTool = findTool("web_fetch");
    expect(registeredTool.renderResult).toBeDefined();

    const pageContent = "# Example Article";

    const result = {
      content: [
        {
          type: "text",
          text: [
            "> URL: https://example.com/article",
            "> Title: Example Article",
            "> Published: 2026-04-10",
            "> Author: Ada Lovelace",
            "> Site: Example",
            "> Language: en",
            "> Words: 321",
            "> Browser: chrome_145/windows",
            "",
            pageContent,
          ].join("\n"),
        },
      ],
      details: {
        verbose: false,
        format: "markdown",
        maxChars: 50000,
        fetchSummary: {
          kind: "content",
          url: "https://example.com/article",
          finalUrl: "https://example.com/article",
          ok: true,
          charCount: pageContent.length,
          wordCount: 321,
          truncated: false,
          title: "Example Article",
          published: "2026-04-10",
        },
      },
    };

    const collapsedLines = registeredTool
      .renderResult?.(result, { expanded: false }, taggedTheme)
      .render(120);
    const collapsedText = collapsedLines?.join("\n") ?? "";

    expect(collapsedText).toContain(
      "<syntaxKeyword>Title: </syntaxKeyword><syntaxString>Example Article</syntaxString>",
    );
    expect(collapsedText).toContain(
      "<syntaxKeyword>Published: </syntaxKeyword><syntaxString>2026-04-10</syntaxString>",
    );
  });

  it("renders descriptive fetch errors instead of the generic no-result fallback", () => {
    const registeredTool = findTool("web_fetch");
    expect(registeredTool.renderResult).toBeDefined();

    const result = {
      content: [
        {
          type: "text",
          text: [
            "Error: Timeout of 15000ms exceeded while downloading a 10.0 MB file from https://example.com/file.dat.",
            "",
            "> Phase: downloading the response body",
            "> Timeout: 15000ms (15s)",
            "> Suggested timeoutMs: 120000",
            "",
            "The timeoutMs parameter is configurable. Retry this call with a higher timeoutMs value.",
          ].join("\n"),
        },
      ],
      details: {
        error: true,
        errorText:
          "Error: Timeout of 15000ms exceeded while downloading a 10.0 MB file from https://example.com/file.dat.",
        userErrorSummary: "Timed out while downloading the file.",
        verbose: false,
      },
    };

    const lines = registeredTool
      .renderResult?.(result, { expanded: false }, testTheme)
      .render(120);
    const text = lines?.join("\n") ?? "";
    expect(text).toContain("Timed out while downloading the file.");
    expect(text).not.toContain("Suggested timeoutMs: 120000");
  });

  it("renders compact attachment results without content preview", () => {
    const registeredTool = findTool("web_fetch");
    expect(registeredTool.renderResult).toBeDefined();

    const result = {
      content: [
        {
          type: "text",
          text: [
            "> URL: https://example.com/file.pdf",
            "> File size: 42",
            "> Mime type: application/pdf",
            "> File path: /tmp/file.pdf",
          ].join("\n"),
        },
      ],
      details: {
        verbose: false,
        format: "markdown",
        maxChars: 50000,
        fetchSummary: {
          kind: "file",
          url: "https://example.com/file.pdf",
          finalUrl: "https://example.com/file.pdf",
          ok: true,
          filePath: "/tmp/file.pdf",
          fileSize: 42,
          mimeType: "application/pdf",
        },
      },
    };

    const collapsedLines = registeredTool
      .renderResult?.(result, { expanded: false }, testTheme)
      .render(120);
    const collapsedText = collapsedLines?.join("\n") ?? "";
    expect(collapsedText).toContain("File size: 42");
    expect(collapsedText).toContain("Mime type: application/pdf");
    expect(collapsedText).toContain("File path: /tmp/file.pdf");
    expect(collapsedText).not.toContain("Ctrl+O to expand");
  });

  // Sessions persisted before the compact-details change stored the full
  // FetchResult under `details.fetchResult`. pi rehydrates those details on
  // every session load/resume/fork, so the renderer must keep showing them.
  it("rehydrates legacy persisted details.fetchResult content results", () => {
    const registeredTool = findTool("web_fetch");
    expect(registeredTool.renderResult).toBeDefined();

    const legacyMaxChars = 40;
    const legacyContent = `${"Legacy page body line. ".repeat(10).slice(0, legacyMaxChars)}\n\n[... truncated]`;
    const result = {
      content: [
        {
          type: "text",
          text: [
            "> URL: https://example.com/legacy",
            "> Title: Legacy Article",
            "",
            legacyContent,
          ].join("\n"),
        },
      ],
      details: {
        verbose: false,
        format: "markdown",
        maxChars: legacyMaxChars,
        fetchResult: {
          kind: "content",
          url: "https://example.com/legacy",
          finalUrl: "https://example.com/legacy",
          title: "Legacy Article",
          author: "Ada Lovelace",
          published: "2025-11-02",
          site: "Example",
          language: "en",
          wordCount: 87,
          browser: "chrome_145",
          os: "windows",
          content: legacyContent,
        },
      },
    };

    for (const expanded of [false, true] as const) {
      const text =
        registeredTool
          .renderResult?.(result, { expanded }, testTheme)
          .render(120)
          .join("\n") ?? "";

      expect(text).toContain("Title: Legacy Article");
      expect(text).toContain("Published: 2025-11-02");
      expect(text).toContain(
        `${legacyContent.length} chars · 87 words · truncated`,
      );
      expect(text).not.toContain("Legacy page body line.");
    }
  });

  it("does not flag legacy content as truncated when it fits historical maxChars", () => {
    const registeredTool = findTool("web_fetch");
    const legacyContent = "Short legacy body.";
    const result = {
      content: [{ type: "text", text: legacyContent }],
      details: {
        verbose: false,
        format: "markdown",
        maxChars: 50000,
        fetchResult: {
          kind: "content",
          url: "https://example.com/short",
          finalUrl: "https://example.com/short",
          title: "Short Legacy",
          author: "",
          published: "",
          site: "",
          language: "en",
          wordCount: 3,
          browser: "chrome_145",
          os: "windows",
          content: legacyContent,
        },
      },
    };

    const text =
      registeredTool
        .renderResult?.(result, { expanded: false }, testTheme)
        .render(120)
        .join("\n") ?? "";

    expect(text).toContain("Title: Short Legacy");
    expect(text).not.toContain("Published:");
    expect(text).toContain(`${legacyContent.length} chars · 3 words`);
    expect(text).not.toContain("truncated");
  });

  // Legacy sessions persisted `details.maxChars` as the settings default, not
  // the per-call `maxChars` that actually truncated the content.
  it("flags legacy content truncated by a smaller per-call maxChars than the persisted default", () => {
    const registeredTool = findTool("web_fetch");
    const perCallMaxChars = 40;
    const legacyContent = `${"Legacy page body line. ".repeat(10).slice(0, perCallMaxChars)}\n\n[... truncated]`;
    const result = {
      content: [{ type: "text", text: legacyContent }],
      details: {
        verbose: false,
        format: "markdown",
        maxChars: 50000,
        fetchResult: {
          kind: "content",
          url: "https://example.com/custom-limit",
          finalUrl: "https://example.com/custom-limit",
          title: "Custom Limit Article",
          author: "",
          published: "",
          site: "",
          language: "en",
          wordCount: 87,
          browser: "chrome_145",
          os: "windows",
          content: legacyContent,
        },
      },
    };

    for (const expanded of [false, true] as const) {
      const text =
        registeredTool
          .renderResult?.(result, { expanded }, testTheme)
          .render(120)
          .join("\n") ?? "";

      expect(text).toContain("Title: Custom Limit Article");
      expect(text).toContain(`${legacyContent.length} chars`);
      expect(text).toMatch(/truncated/i);
      expect(text).not.toContain("Legacy page body line.");
    }
  });

  it("marks a current result truncated at maxChars as truncated", () => {
    const registeredTool = findTool("web_fetch");
    const result = {
      content: [{ type: "text", text: "> Title: Truncated Article" }],
      details: {
        verbose: false,
        format: "markdown",
        maxChars: 40,
        fetchSummary: {
          kind: "content",
          url: "https://example.com/truncated",
          finalUrl: "https://example.com/truncated",
          ok: true,
          charCount: 57,
          wordCount: 87,
          truncated: true,
          title: "Truncated Article",
          published: "",
        },
      },
    };

    for (const expanded of [false, true] as const) {
      const text =
        registeredTool
          .renderResult?.(result, { expanded }, testTheme)
          .render(120)
          .join("\n") ?? "";

      expect(text).toContain("57 chars");
      expect(text).toMatch(/truncated/i);
    }
  });

  // Core reports `wordCount: 0` for raw responses because it never counts
  // words there; the renderer must not present that as a measured zero.
  it("does not report zero words for a nonempty legacy raw response", () => {
    const registeredTool = findTool("web_fetch");
    const rawBody =
      '{"items":[{"id":1,"name":"alpha"},{"id":2,"name":"beta"}]}';
    const result = {
      content: [{ type: "text", text: rawBody }],
      details: {
        verbose: false,
        format: "raw",
        maxChars: 50000,
        fetchResult: {
          kind: "content",
          url: "https://example.com/api/items",
          finalUrl: "https://example.com/api/items",
          title: "",
          author: "",
          published: "",
          site: "example.com",
          language: "",
          wordCount: 0,
          browser: "chrome_145",
          os: "windows",
          contentType: "application/json",
          content: rawBody,
        },
      },
    };

    for (const expanded of [false, true] as const) {
      const text =
        registeredTool
          .renderResult?.(result, { expanded }, testTheme)
          .render(120)
          .join("\n") ?? "";

      expect(text).toContain(`${rawBody.length} chars`);
      expect(text).not.toMatch(/\b0 words\b/);
      expect(text).not.toContain('"name":"alpha"');
    }
  });

  it("rehydrates legacy persisted details.fetchResult file results", () => {
    const registeredTool = findTool("web_fetch");
    const result = {
      content: [
        {
          type: "text",
          text: "> URL: https://example.com/report.pdf\n> File path: /tmp/legacy-report.pdf",
        },
      ],
      details: {
        verbose: false,
        format: "markdown",
        maxChars: 50000,
        fetchResult: {
          kind: "file",
          url: "https://example.com/report.pdf",
          finalUrl: "https://cdn.example.com/report.pdf",
          title: "",
          author: "",
          published: "",
          site: "",
          language: "",
          wordCount: 0,
          browser: "chrome_145",
          os: "windows",
          content: "",
          filePath: "/tmp/legacy-report.pdf",
          fileSize: 2048,
          mimeType: "application/pdf",
        },
      },
    };

    const text =
      registeredTool
        .renderResult?.(result, { expanded: false }, testTheme)
        .render(120)
        .join("\n") ?? "";

    expect(text).toContain("File size: 2048");
    expect(text).toContain("Mime type: application/pdf");
    expect(text).toContain("File path: /tmp/legacy-report.pdf");
  });

  it("prefers details.fetchSummary over a legacy details.fetchResult when both exist", () => {
    const registeredTool = findTool("web_fetch");
    const result = {
      content: [{ type: "text", text: "> Title: Current Summary Title" }],
      details: {
        verbose: false,
        format: "markdown",
        maxChars: 50000,
        fetchResult: {
          kind: "content",
          url: "https://example.com/stale",
          finalUrl: "https://example.com/stale",
          title: "Stale Legacy Title",
          author: "",
          published: "2020-01-01",
          site: "",
          language: "en",
          wordCount: 999,
          browser: "chrome_145",
          os: "windows",
          content: "Stale legacy page body.",
        },
        fetchSummary: {
          kind: "content",
          url: "https://example.com/current",
          finalUrl: "https://example.com/current",
          ok: true,
          charCount: 1234,
          wordCount: 210,
          truncated: false,
          title: "Current Summary Title",
          published: "2026-10-01",
        },
      },
    };

    const text =
      registeredTool
        .renderResult?.(result, { expanded: true }, testTheme)
        .render(120)
        .join("\n") ?? "";

    expect(text).toContain("Title: Current Summary Title");
    expect(text).toContain("Published: 2026-10-01");
    expect(text).toContain("1234 chars · 210 words");
    expect(text).not.toContain("Stale Legacy Title");
    expect(text).not.toContain("2020-01-01");
    expect(text).not.toContain("999 words");
    expect(text).not.toContain("Stale legacy page body.");
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
      "Error: Invalid URL: not-a-url",
    );
    expect(response.details?.batchSummary).toBeDefined();
    expect(response.details?.batchProgress).toBeDefined();

    const details = response.details as {
      batchSummary?: {
        items?: Array<Record<string, unknown>>;
      };
    };
    expect(details?.batchSummary?.items?.[0]).toMatchObject({
      index: 0,
      url: "not-a-url",
      ok: false,
      status: "error",
    });
    expect(details?.batchSummary?.items?.[0]?.error).toContain("Invalid URL");
  });
});
