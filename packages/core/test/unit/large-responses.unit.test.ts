import { afterAll, describe, expect, it, mock } from "bun:test";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { runtimeDependencies } from "../../src/dependencies";
import { createDefuddleFetch, defuddleFetch, isError } from "../../src/extract";
import type {
  ContentFetchResult,
  ExtractedContent,
  FetchDependencies,
  FetchError,
  FetchResponseLike,
  FetchResult,
} from "../../src/types";

const KB = 1024;

function contentResult(result: FetchResult | FetchError): ContentFetchResult {
  if (isError(result) || result.kind !== "content") {
    throw new Error(
      `expected a content result, got ${JSON.stringify(result).slice(0, 300)}`,
    );
  }
  return result;
}

interface BodyTracker {
  /** Bytes the consumer pulled from the body stream. */
  pulledBytes: number;
  /** Whether the consumer cancelled the body stream. */
  cancelled: boolean;
  /** Whether text()/arrayBuffer()/readable() materialized the whole body. */
  materialized: boolean;
}

function splitIntoChunks(text: string, chunkSize: number): Uint8Array[] {
  const bytes = new TextEncoder().encode(text);
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    chunks.push(bytes.subarray(offset, offset + chunkSize));
  }
  return chunks;
}

function streamingResponse({
  body,
  contentType,
  contentLength,
  chunkSize = 16 * KB,
}: {
  body: string;
  contentType: string;
  contentLength?: number;
  chunkSize?: number;
}): { response: FetchResponseLike; tracker: BodyTracker } {
  const tracker: BodyTracker = {
    pulledBytes: 0,
    cancelled: false,
    materialized: false,
  };
  const chunks = splitIntoChunks(body, chunkSize);
  let index = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks[index++];
        if (!chunk) {
          controller.close();
          return;
        }
        tracker.pulledBytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        tracker.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const fullBody = new TextEncoder().encode(body);

  return {
    tracker,
    response: {
      ok: true,
      status: 200,
      statusText: "OK",
      url: "https://example.com/big",
      headers: {
        get(name: string) {
          const normalized = name.toLowerCase();
          if (normalized === "content-type") return contentType;
          if (normalized === "content-length" && contentLength !== undefined) {
            return String(contentLength);
          }
          return null;
        },
      },
      body: stream,
      text: async () => {
        tracker.materialized = true;
        return body;
      },
      arrayBuffer: async () => {
        tracker.materialized = true;
        return fullBody.buffer.slice(0) as ArrayBuffer;
      },
      readable: () => {
        tracker.materialized = true;
        return Readable.from([fullBody]);
      },
    },
  };
}

function articlePage(paragraphs: number, lateMarker = "MARKER_LATE"): string {
  const filler = Array.from(
    { length: paragraphs },
    (_, index) =>
      `<p>Paragraph ${index} talks about connection pools, page caches and write-ahead logs in enough detail to matter.</p>`,
  ).join("");
  return `<html><head><title>Big</title></head><body><article><h1>Start</h1><p>MARKER_EARLY opens the article.</p>${filler}<p>${lateMarker} closes the article.</p></article></body></html>`;
}

function capturingDefuddle(seen: { text?: string }) {
  return mock(async (document: Document) => {
    seen.text = document.body?.textContent ?? "";
    return {
      content: `# Big\n\n${"word ".repeat(60).trim()}`,
      wordCount: 60,
      title: "Big",
    } satisfies ExtractedContent;
  });
}

function dependenciesFor(
  response: FetchResponseLike,
  overrides: Partial<FetchDependencies> = {},
): FetchDependencies {
  return {
    fetch: mock(async () => response),
    defuddle: mock(async () => ({ content: "", wordCount: 0 })),
    getProfiles: () => ["chrome_145"],
    ...overrides,
  };
}

describe("maxResponseBytes", () => {
  it("reads at most maxResponseBytes of an HTML body, cancels the stream, and marks the result truncated", async () => {
    const limit = 64 * KB;
    const html = articlePage(6_000);
    expect(html.length).toBeGreaterThan(10 * limit);
    const { response, tracker } = streamingResponse({
      body: html,
      contentType: "text/html; charset=utf-8",
    });
    const seen: { text?: string } = {};
    const defuddleFetch = createDefuddleFetch(
      dependenciesFor(response, { defuddle: capturingDefuddle(seen) }),
    );

    const result = await defuddleFetch({
      url: "https://example.com/big",
      maxResponseBytes: limit,
    });

    expect(contentResult(result).responseTruncated).toEqual({
      bytesRead: limit,
    });
    expect(seen.text).toContain("MARKER_EARLY");
    expect(seen.text).not.toContain("MARKER_LATE");
    expect(tracker.materialized).toBe(false);
    expect(tracker.pulledBytes).toBeLessThanOrEqual(limit + 16 * KB);
    expect(tracker.cancelled).toBe(true);
  });

  it("reports the declared size when Content-Length exceeds maxResponseBytes and still reads only the limit", async () => {
    const limit = 64 * KB;
    const html = articlePage(6_000);
    const declared = new TextEncoder().encode(html).byteLength;
    const { response, tracker } = streamingResponse({
      body: html,
      contentType: "text/html; charset=utf-8",
      contentLength: declared,
    });
    const defuddleFetch = createDefuddleFetch(
      dependenciesFor(response, { defuddle: capturingDefuddle({}) }),
    );

    const result = await defuddleFetch({
      url: "https://example.com/big",
      maxResponseBytes: limit,
    });

    expect(contentResult(result).responseTruncated).toEqual({
      bytesRead: limit,
      contentLength: declared,
    });
    expect(tracker.materialized).toBe(false);
    expect(tracker.pulledBytes).toBeLessThanOrEqual(limit + 16 * KB);
    expect(tracker.cancelled).toBe(true);
  });

  it("rejects a JSON response whose Content-Length exceeds maxResponseBytes without reading the body", async () => {
    const limit = 64 * KB;
    const json = JSON.stringify({
      items: Array.from({ length: 20_000 }, (_, index) => ({ index })),
    });
    const declared = new TextEncoder().encode(json).byteLength;
    expect(declared).toBeGreaterThan(limit);
    const { response, tracker } = streamingResponse({
      body: json,
      contentType: "application/json",
      contentLength: declared,
    });
    const dependencies = dependenciesFor(response);
    const defuddleFetch = createDefuddleFetch(dependencies);

    const result = await defuddleFetch({
      url: "https://example.com/data.json",
      format: "json",
      maxResponseBytes: limit,
    });

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result).toMatchObject({
        code: "response_too_large",
        phase: "loading",
        retryable: false,
        contentLength: declared,
        maxResponseBytes: limit,
      });
      expect(result.error).toContain("maxResponseBytes");
    }
    expect(tracker.pulledBytes).toBe(0);
    expect(tracker.materialized).toBe(false);
    expect(tracker.cancelled).toBe(true);
    expect(dependencies.defuddle).not.toHaveBeenCalled();
  });

  it("rejects a streamed JSON body that exceeds maxResponseBytes instead of parsing a truncated document", async () => {
    const limit = 64 * KB;
    const json = JSON.stringify({
      items: Array.from({ length: 20_000 }, (_, index) => ({ index })),
    });
    const { response, tracker } = streamingResponse({
      body: json,
      contentType: "application/json",
    });
    const defuddleFetch = createDefuddleFetch(dependenciesFor(response));

    const result = await defuddleFetch({
      url: "https://example.com/data.json",
      maxResponseBytes: limit,
    });

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result).toMatchObject({
        code: "response_too_large",
        phase: "loading",
        downloadedBytes: limit,
        maxResponseBytes: limit,
      });
    }
    expect(tracker.materialized).toBe(false);
    expect(tracker.pulledBytes).toBeLessThanOrEqual(limit + 16 * KB);
    expect(tracker.cancelled).toBe(true);
  });

  it("truncates plain-text bodies at maxResponseBytes and marks the result truncated", async () => {
    const limit = 64 * KB;
    const text = `FIRST_LINE\n${"lorem ipsum dolor sit amet\n".repeat(20_000)}LAST_LINE\n`;
    const { response, tracker } = streamingResponse({
      body: text,
      contentType: "text/plain; charset=utf-8",
    });
    const defuddleFetch = createDefuddleFetch(dependenciesFor(response));

    const result = await defuddleFetch({
      url: "https://example.com/big.txt",
      format: "text",
      maxChars: 10_000_000,
      maxResponseBytes: limit,
    });

    const content = contentResult(result);
    expect(content.content.startsWith("FIRST_LINE")).toBe(true);
    expect(content.content).not.toContain("LAST_LINE");
    expect(content.responseTruncated).toEqual({ bytesRead: limit });
    expect(tracker.materialized).toBe(false);
    expect(tracker.cancelled).toBe(true);
  });

  it("applies an explicit maxResponseBytes to raw responses", async () => {
    const limit = 64 * KB;
    const html = articlePage(6_000);
    const { response, tracker } = streamingResponse({
      body: html,
      contentType: "text/html; charset=utf-8",
    });
    const dependencies = dependenciesFor(response);
    const defuddleFetch = createDefuddleFetch(dependencies);

    const result = await defuddleFetch({
      url: "https://example.com/big",
      format: "raw",
      maxResponseBytes: limit,
    });

    // Raw output stays byte-for-byte the served prefix; the truncation is
    // reported as metadata, not appended to the body.
    const content = contentResult(result);
    expect(content.content).toBe(html.slice(0, limit));
    expect(content.responseTruncated).toEqual({ bytesRead: limit });
    expect(tracker.materialized).toBe(false);
    expect(tracker.cancelled).toBe(true);
    expect(dependencies.defuddle).not.toHaveBeenCalled();
  });

  it("says the body was truncated when the processed prefix holds no readable content", async () => {
    const limit = 64 * KB;
    const html = `<html><head><style>${".rule { color: red; }\n".repeat(10_000)}</style></head><body><main><p>The real content sits after the stylesheet.</p></main></body></html>`;
    const { response } = streamingResponse({
      body: html,
      contentType: "text/html; charset=utf-8",
    });
    const defuddleFetch = createDefuddleFetch(
      dependenciesFor(response, {
        defuddle: mock(async () => ({ content: "", wordCount: 0 })),
      }),
    );

    const result = await defuddleFetch({
      url: "https://example.com/styled",
      maxResponseBytes: limit,
    });

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.code).toBe("no_content");
      expect(result.error).toContain(
        "Only the first 64.0 KB of the response body was read; raise maxResponseBytes to read more.",
      );
    }
  });
});

describe("processing phase attribution", () => {
  it("ignores transfer events that arrive after the body was read", async () => {
    let onRequestEvent: ((event: Record<string, unknown>) => void) | undefined;
    const { response } = streamingResponse({
      body: articlePage(10),
      contentType: "text/html; charset=utf-8",
    });
    const defuddleFetch = createDefuddleFetch({
      fetch: mock(async (_url: string, options: Record<string, unknown>) => {
        onRequestEvent = options.onRequestEvent as typeof onRequestEvent;
        return response;
      }),
      defuddle: mock(async () => ({ content: "", wordCount: 0 })),
      getProfiles: () => ["chrome_145"],
      analyzeHtml: mock(async () => {
        // The native client can report read-ahead progress after the body
        // stream was consumed or cancelled.
        onRequestEvent?.({ type: "body_progress", downloadedBytes: 1024 });
        throw new Error("operation timed out");
      }),
    });
    const updates: Array<{ status: string; phase?: string }> = [];

    const result = await defuddleFetch(
      { url: "https://example.com/big", timeoutMs: 5_000 },
      {
        onProgressChange(update) {
          updates.push(update);
        },
      },
    );

    expect(result).toMatchObject({ code: "timeout", phase: "processing" });
    const extractingAt = updates.findIndex(
      (update) => update.phase === "extracting",
    );
    expect(extractingAt).toBeGreaterThan(-1);
    expect(
      updates.slice(extractingAt).some((update) => update.status === "loading"),
    ).toBe(false);
  });

  it("reports a raw-mode X/Twitter extraction failure as a processing error", async () => {
    const { response } = streamingResponse({
      body: articlePage(10),
      contentType: "text/html; charset=utf-8",
    });
    const defuddleFetch = createDefuddleFetch(
      dependenciesFor(response, {
        defuddle: mock(async () => {
          throw new Error("extractor exploded");
        }),
      }),
    );

    const result = await defuddleFetch({
      url: "https://x.com/user/status/12345",
      format: "raw",
    });

    expect(result).toMatchObject({
      code: "processing_error",
      phase: "processing",
      retryable: false,
    });
    expect(isError(result) ? result.error : "").toContain("extractor exploded");
  });
});

// docs.rs-style source view: every token in its own <span>, separated by
// whitespace text nodes. Defuddle's cost on this shape grows faster than
// linearly, which is what froze the pi event loop.
function syntaxHighlightedPage(targetBytes: number): string {
  const lines: string[] = [];
  let bytes = 0;
  for (let index = 0; bytes < targetBytes; index++) {
    const line = `<span class="syntax-keyword syntax-rust">let</span> <span class="syntax-storage syntax-rust">mut</span> <span class="syntax-variable syntax-rust">conn_${index}</span><span class="syntax-punctuation syntax-rust">:</span> <span class="syntax-entity syntax-rust">Connection</span> <span class="syntax-operator syntax-rust">=</span> <span class="syntax-meta syntax-rust"><span class="syntax-function syntax-rust">open_${index % 97}</span><span class="syntax-punctuation syntax-rust">(</span><span class="syntax-string syntax-rust">&quot;db-${index}&quot;</span><span class="syntax-punctuation syntax-rust">)</span></span><span class="syntax-operator syntax-rust">?</span><span class="syntax-punctuation syntax-rust">;</span>`;
    lines.push(line);
    bytes += line.length + 1;
  }
  return `<html><head><title>connection.rs - source</title></head><body><div id="source-code"><pre><code><span class="syntax-source syntax-rust">${lines.join("\n")}</span></code></pre></div></body></html>`;
}

function htmlResponse(html: string): FetchResponseLike {
  return streamingResponse({
    body: html,
    contentType: "text/html; charset=utf-8",
  }).response;
}

describe("content extraction isolation", () => {
  it(
    "keeps the event loop responsive while a large page is extracted",
    async () => {
      const html = syntaxHighlightedPage(192 * KB);
      const defuddleFetch = createDefuddleFetch({
        ...runtimeDependencies,
        fetch: mock(async () => htmlResponse(html)),
      });

      let last = performance.now();
      let maxGapMs = 0;
      const heartbeat = setInterval(() => {
        const now = performance.now();
        maxGapMs = Math.max(maxGapMs, now - last);
        last = now;
      }, 10);
      let result: Awaited<ReturnType<typeof defuddleFetch>>;
      try {
        result = await defuddleFetch({
          url: "https://docs.example/source/connection.rs",
          timeoutMs: 60_000,
        });
        // A block that lasts until the fetch settles never lets a tick run.
        maxGapMs = Math.max(maxGapMs, performance.now() - last);
      } finally {
        clearInterval(heartbeat);
      }

      expect(maxGapMs).toBeLessThan(250);
      expect(isError(result)).toBe(false);
      if (!isError(result)) {
        expect(result.content).toContain("let mut conn_0: Connection");
      }
    },
    { timeout: 60_000 },
  );

  it(
    "abandons an extraction that exceeds its time budget with a processing timeout",
    async () => {
      const html = syntaxHighlightedPage(192 * KB);
      const defuddleFetch = createDefuddleFetch({
        ...runtimeDependencies,
        fetch: mock(async () => htmlResponse(html)),
      });

      const started = performance.now();
      const result = await defuddleFetch({
        url: "https://docs.example/source/connection.rs",
        timeoutMs: 200,
      });
      const elapsedMs = performance.now() - started;

      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result).toMatchObject({
          code: "timeout",
          phase: "processing",
          timeoutMs: 200,
        });
        expect(result.error).toContain(
          "Timeout of 200ms exceeded while processing the response",
        );
      }
      expect(elapsedMs).toBeLessThan(3_000);
    },
    { timeout: 60_000 },
  );

  it(
    "stops the abandoned extraction once its time budget is spent",
    async () => {
      // Takes several seconds to extract, so an extraction that kept running
      // would still be busy during the measurement window below.
      const html = syntaxHighlightedPage(384 * KB);
      const defuddleFetch = createDefuddleFetch({
        ...runtimeDependencies,
        fetch: mock(async () => htmlResponse(html)),
      });

      const result = await defuddleFetch({
        url: "https://docs.example/source/connection.rs",
        timeoutMs: 300,
      });
      expect(result).toMatchObject({ code: "timeout", phase: "processing" });

      // Allow for slow worker termination, then sample process CPU time.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const before = process.cpuUsage();
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const used = process.cpuUsage(before);
      expect((used.user + used.system) / 1_000).toBeLessThan(400);
    },
    { timeout: 60_000 },
  );
});

describe("live HTTP bodies", () => {
  const openResponses = new Set<ServerResponse>();
  const server = createServer((_request, response) => {
    openResponses.add(response);
    response.on("close", () => openResponses.delete(response));
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.write(
      `<html><head><title>Endless</title></head><body><article><h1>Endless</h1>${"<p>The stream keeps going and never finishes its article body.</p>".repeat(8_000)}`,
    );
    // Never end the response: keep trickling bytes until the client hangs up.
    const trickle = setInterval(() => response.write("<p>tick</p>"), 50);
    response.on("close", () => clearInterval(trickle));
  });
  const listening = new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );

  afterAll(() => {
    for (const response of openResponses) response.destroy();
    server.closeAllConnections();
    server.close();
  });

  it(
    "returns a truncated result for a response body that never ends",
    async () => {
      await listening;
      const { port } = server.address() as AddressInfo;

      const result = await defuddleFetch({
        url: `http://127.0.0.1:${port}/endless`,
        maxResponseBytes: 128 * KB,
        timeoutMs: 30_000,
      });

      const content = contentResult(result);
      expect(content.content).toContain("never finishes its article body");
      expect(content.responseTruncated).toEqual({ bytesRead: 128 * KB });
    },
    { timeout: 15_000 },
  );
});
