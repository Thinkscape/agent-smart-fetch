import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ExtensionAPI, initTheme } from "@earendil-works/pi-coding-agent";
import piSmartFetchExtension from "../../src/index";

/**
 * Proves the session-file bloat fix: pi persists tool-result `details` into
 * session files and rehydrates them on every session load/resume/fork, so
 * `details` must never embed the full fetched page text. These tests run the
 * real fetch pipeline against a local HTTP server and assert that the page
 * marker survives in the agent-facing `content` text while `details` stay a
 * small, compact summary.
 */

const PAGE_MARKER = "UNIQUEPAGEMARKERX7Q9";
const SENTENCE_COUNT = 2500;
const SENTENCE = `Sesame cookie oat cake ${PAGE_MARKER} lemon drops brownie. `;
const PAGE_BODY = `<html><head><title>Bloat Probe Article</title></head><body><article><h1>Bloat Probe Heading</h1>${Array.from(
  { length: SENTENCE_COUNT },
  () => `<p>${SENTENCE}</p>`,
).join("")}</article></body></html>`;

interface ToolExecutionDetails {
  verbose: boolean;
  started: boolean;
  fetchSummary?: {
    kind: string;
    url: string;
    finalUrl: string;
    ok: boolean;
    charCount: number;
    wordCount: number;
    truncated: boolean;
    title?: string;
    published?: string;
  };
  batchSummary?: {
    total: number;
    succeeded: number;
    failed: number;
    durationMs: number;
    items: Array<{
      index: number;
      url: string;
      ok: boolean;
      status: string;
      charCount?: number;
      wordCount?: number;
      truncated?: boolean;
      error?: string;
    }>;
  };
  durationMs?: number;
}

interface RegisteredTool {
  name: string;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: ((result: unknown) => void) | undefined,
    ctx: { cwd: string },
  ): Promise<{
    content: Array<{ type: string; text: string }>;
    details?: ToolExecutionDetails;
  }>;
}

function findTools() {
  const tools: RegisteredTool[] = [];
  piSmartFetchExtension({
    registerTool(definition: unknown) {
      tools.push(definition as RegisteredTool);
    },
  } as unknown as ExtensionAPI);
  return tools;
}

async function withLocalServer<T>(fn: (url: string) => Promise<T>): Promise<T> {
  const server: Server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(PAGE_BODY);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("unexpected server address");
  }

  try {
    return await fn(`http://127.0.0.1:${address.port}/`).then((result) => {
      server.close();
      return result;
    });
  } catch (error) {
    server.close();
    throw error;
  }
}

initTheme("dark");

describe("compact tool-result details (session-file bloat fix)", () => {
  it("web_fetch keeps the page text in content and stores a compact summary in details", async () => {
    const [tool] = findTools().filter(
      (candidate) => candidate.name === "web_fetch",
    );
    const cwd = await mkdtemp(join(tmpdir(), "smart-fetch-pi-compact-"));
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({ smartFetchVerboseByDefault: false }, null, 2),
    );

    const response = await withLocalServer(async (url) => {
      const result = await tool.execute(
        "compact-web-fetch",
        { url, timeoutMs: 20000 },
        undefined,
        undefined,
        { cwd },
      );
      return result;
    });
    const agentText = response.content[0]?.text ?? "";
    const details = response.details as ToolExecutionDetails;
    const detailsJson = JSON.stringify(details);

    // The agent-facing output is unchanged: full metadata + page text.
    expect(agentText).toContain(PAGE_MARKER);
    expect(agentText).toContain("Bloat Probe Heading");

    // Details are a compact summary: bounded size, no page text.
    const summary = details.fetchSummary;
    expect(summary).toBeDefined();
    expect(summary?.kind).toBe("content");
    expect(summary?.url).toContain("127.0.0.1");
    expect(summary?.ok).toBe(true);
    expect(summary?.charCount).toBeGreaterThan(0);
    expect(summary?.wordCount).toBeGreaterThan(0);
    // Page is far larger than the default maxChars, so it is truncated.
    expect(summary?.truncated).toBe(true);
    expect(details.durationMs).toBeGreaterThan(0);
    expect(detailsJson).not.toContain(PAGE_MARKER);
    expect(Buffer.byteLength(detailsJson)).toBeLessThan(2048);
  });

  it("batch_web_fetch keeps per-item page text in content and stores a compact summary in details", async () => {
    const [tool] = findTools().filter(
      (candidate) => candidate.name === "batch_web_fetch",
    );
    const cwd = await mkdtemp(join(tmpdir(), "smart-fetch-pi-batch-compact-"));
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({ smartFetchVerboseByDefault: false }, null, 2),
    );

    const response = await withLocalServer(async (url) => {
      const result = await tool.execute(
        "compact-batch-web-fetch",
        {
          requests: [
            { url, timeoutMs: 20000, maxChars: 2000 },
            { url: "not-a-url" },
          ],
          timeoutMs: 20000,
        },
        undefined,
        undefined,
        { cwd },
      );
      return result;
    });
    const agentText = response.content[0]?.text ?? "";
    const details = response.details as ToolExecutionDetails;
    const detailsJson = JSON.stringify(details);

    // Per-item content (page text for the ok item, error for the bad one).
    expect(agentText).toContain(PAGE_MARKER);
    expect(agentText).toContain("Error: Invalid URL: not-a-url");

    // Compact per-item summaries: bounded size, no page text.
    const summary = details.batchSummary;
    expect(summary).toBeDefined();
    expect(summary?.total).toBe(2);
    expect(summary?.succeeded).toBe(1);
    expect(summary?.failed).toBe(1);
    expect(summary?.durationMs).toBeGreaterThan(0);

    const okItem = summary?.items.find((item) => item.ok);
    const errorItem = summary?.items.find((item) => !item.ok);
    expect(okItem?.status).toBe("done");
    expect(okItem?.charCount).toBeLessThanOrEqual(2000 + 64);
    expect(okItem?.truncated).toBe(true);
    expect(errorItem?.status).toBe("error");
    expect(errorItem?.error).toContain("Invalid URL");

    expect(detailsJson).not.toContain(PAGE_MARKER);
    expect(Buffer.byteLength(detailsJson)).toBeLessThan(4096);
  });
});
