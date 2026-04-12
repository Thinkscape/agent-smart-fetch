import { describe, expect, it } from "bun:test";
import {
  createBatchFetchToolParameterProperties,
  executeBatchFetchToolCall,
  resolveFetchToolDefaults,
} from "../../src/tool";

describe("resolveFetchToolDefaults", () => {
  it("includes batchConcurrency with the default value", () => {
    expect(resolveFetchToolDefaults()).toEqual({
      maxChars: 50000,
      timeoutMs: 15000,
      browser: "chrome_145",
      os: "windows",
      removeImages: false,
      includeReplies: "extractors",
      batchConcurrency: 8,
      tempDir: undefined,
    });
  });

  it("normalizes batchConcurrency overrides", () => {
    expect(
      resolveFetchToolDefaults({ batchConcurrency: 3.9 }).batchConcurrency,
    ).toBe(3);
    expect(
      resolveFetchToolDefaults({ batchConcurrency: 0 }).batchConcurrency,
    ).toBe(8);
  });
});

describe("createBatchFetchToolParameterProperties", () => {
  it("creates a requests array where each item matches the single-fetch surface", () => {
    const defaults = resolveFetchToolDefaults();
    const schema = createBatchFetchToolParameterProperties(defaults) as {
      requests?: {
        type?: string;
        minItems?: number;
        items?: {
          required?: string[];
          properties?: Record<string, { type?: string }>;
        };
      };
    };

    expect(schema.requests?.type).toBe("array");
    expect(schema.requests?.minItems).toBe(1);
    expect(schema.requests?.items?.required).toContain("url");
    expect(schema.requests?.items?.properties?.proxy?.type).toBe("string");
  });
});

describe("executeBatchFetchToolCall", () => {
  it("preserves input ordering, reports progress, and carries per-item errors", async () => {
    const defaults = resolveFetchToolDefaults({ batchConcurrency: 2 });
    const snapshots: Array<{
      completed: number;
      statuses: string[];
      progresses: number[];
    }> = [];

    const result = await executeBatchFetchToolCall(
      {
        requests: [
          { url: "https://example.com/first" },
          { url: "https://example.com/second" },
          { url: "https://example.com/fail" },
        ],
      },
      defaults,
      {
        onProgress(snapshot) {
          snapshots.push({
            completed: snapshot.completed,
            statuses: snapshot.items.map((item) => item.status),
            progresses: snapshot.items.map((item) => item.progress),
          });
        },
        async executeItem(params, _runtimeDefaults, hooks) {
          hooks?.onProgressChange?.({
            status: "connecting",
            progress: 0.15,
            phase: "request_sent",
          });
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              params.url === "https://example.com/second" ? 10 : 1,
            ),
          );

          if (params.url === "https://example.com/fail") {
            return { error: `HTTP 500 for ${params.url}` };
          }

          hooks?.onStatusChange?.("processing");
          return {
            kind: "content",
            url: params.url as string,
            finalUrl: params.url as string,
            title: `Title for ${params.url}`,
            author: "",
            published: "",
            site: "Example",
            language: "en",
            wordCount: 2,
            content: `Content for ${params.url}`,
            browser: defaults.browser,
            os: defaults.os,
          };
        },
      },
    );

    expect(result.total).toBe(3);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.batchConcurrency).toBe(2);
    expect(result.items.map((item) => item.request.url)).toEqual([
      "https://example.com/first",
      "https://example.com/second",
      "https://example.com/fail",
    ]);
    expect(result.items[0]?.status).toBe("done");
    expect(result.items[1]?.status).toBe("done");
    expect(result.items[2]?.status).toBe("error");
    expect(result.items[2]?.error).toBe(
      "HTTP 500 for https://example.com/fail",
    );
    expect(snapshots[0]?.statuses).toEqual(["queued", "queued", "queued"]);
    expect(
      snapshots.some((snapshot) => snapshot.progresses.includes(0.15)),
    ).toBe(true);
    expect(
      snapshots.some((snapshot) => snapshot.statuses.includes("connecting")),
    ).toBe(true);
    expect(snapshots.at(-1)).toEqual({
      completed: 3,
      statuses: ["done", "done", "error"],
      progresses: [1, 1, 1],
    });
  });
});
