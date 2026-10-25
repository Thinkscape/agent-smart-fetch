import { describe, expect, it } from "bun:test";
import {
  buildBatchFetchResponseText,
  buildCompactMetadataHeader,
  buildFetchErrorResponseText,
  buildFetchResponseText,
  buildMetadataHeader,
  buildUserFacingFetchErrorSummary,
  escapeHtml,
  markdownToText,
  parseAndFormatJson,
  renderJsonContent,
  stripExtractorComments,
  truncateContent,
} from "../../src/format";
import type { BatchFetchResult, FetchResult } from "../../src/types";

describe("markdownToText", () => {
  it("strips common markdown syntax while preserving readable text", () => {
    const input =
      "# Heading\n\n**bold** *italic* [link](https://example.com) `code`\n- item";
    const output = markdownToText(input);

    expect(output).toContain("Heading");
    expect(output).toContain("bold italic link code");
    expect(output).toContain("• item");
    expect(output).not.toContain("# ");
    expect(output).not.toContain("[");
  });
});

describe("JSON formatting helpers", () => {
  it("pretty-prints valid JSON", () => {
    expect(parseAndFormatJson('{"hello":"world"}')).toEqual({
      formatted: '{\n  "hello": "world"\n}',
    });
  });

  it("returns an error for invalid JSON", () => {
    expect(parseAndFormatJson("not-json")).toEqual({
      error: "Invalid JSON response",
    });
  });

  it("renders JSON appropriately for markdown, text, and html", () => {
    const formatted = '{\n  "hello": "world"\n}';

    expect(renderJsonContent(formatted, "markdown")).toBe(
      '```json\n{\n  "hello": "world"\n}\n```',
    );
    expect(renderJsonContent(formatted, "text")).toBe(formatted);
    expect(renderJsonContent(formatted, "json")).toBe(formatted);
    expect(renderJsonContent(formatted, "html")).toBe(
      '<pre><code class="language-json">{\n  &quot;hello&quot;: &quot;world&quot;\n}</code></pre>',
    );
  });

  it("escapes HTML entities", () => {
    expect(escapeHtml('<tag attr="x">&</tag>')).toBe(
      "&lt;tag attr=&quot;x&quot;&gt;&amp;&lt;/tag&gt;",
    );
  });

  it("strips site extractor comment sections", () => {
    expect(
      stripExtractorComments(
        "Story\n\n---\n\n## Comments\n\n> hello",
        "markdown",
      ),
    ).toBe("Story");
    expect(
      stripExtractorComments(
        '<div class="post">Story</div><hr><div class="hackernews comments">Hello</div>',
        "html",
      ),
    ).toBe('<div class="post">Story</div>');
  });
});

describe("truncateContent", () => {
  it("returns content unchanged when within limit", () => {
    expect(truncateContent("hello", 10)).toBe("hello");
  });

  it("adds a truncation marker when content exceeds max chars", () => {
    const output = truncateContent("abcdefghij", 5);
    expect(output).toBe("abcde\n\n[... truncated]");
  });
});

describe("error formatting", () => {
  it("builds short user-facing summaries", () => {
    expect(
      buildUserFacingFetchErrorSummary({
        error: "whatever",
        code: "http_error",
        statusCode: 503,
        statusText: "Service Unavailable",
      }),
    ).toBe("Server responded with 503 Service Unavailable");
    expect(
      buildUserFacingFetchErrorSummary({
        error: "whatever",
        code: "timeout",
        phase: "loading",
        mimeType: "application/octet-stream",
      }),
    ).toBe("Timed out while downloading the file.");
    expect(
      buildUserFacingFetchErrorSummary({
        error: "whatever",
        code: "invalid_url",
      }),
    ).toBe("That URL is invalid.");
  });

  it("renders timeout errors with retry guidance and known metadata", () => {
    const output = buildFetchErrorResponseText({
      error:
        "Timeout of 15000ms exceeded while downloading a 10.0 MB file from https://example.com/file.dat.",
      code: "timeout",
      phase: "loading",
      timeoutMs: 15000,
      url: "https://example.com/file.dat",
      finalUrl: "https://cdn.example.com/file.dat",
      statusCode: 200,
      statusText: "OK",
      mimeType: "application/octet-stream",
      contentLength: 10 * 1024 * 1024,
      downloadedBytes: 2 * 1024 * 1024,
    });

    expect(output).toContain("Error: Timeout of 15000ms exceeded");
    expect(output).toContain("> Phase: downloading the response body");
    expect(output).toContain("> Timeout: 15000ms (15s)");
    expect(output).toContain("> HTTP status: 200 OK");
    expect(output).toContain("> Content-Length: 10485760 bytes (10.0 MB)");
    expect(output).toContain(
      "> Downloaded before failure: 2097152 bytes (2.00 MB)",
    );
    expect(output).toContain("> Suggested timeoutMs: 120000");
    expect(output).toContain("The timeoutMs parameter is configurable.");
  });

  it("points processing timeouts at maxResponseBytes", () => {
    const output = buildFetchErrorResponseText({
      error:
        "Timeout of 15000ms exceeded while processing the response from https://docs.rs/big.",
      code: "timeout",
      phase: "processing",
      timeoutMs: 15000,
      url: "https://docs.rs/big",
    });

    expect(output).toContain("> Phase: processing the response");
    expect(output).toContain(
      "a smaller maxResponseBytes makes it process less of the page.",
    );
  });

  it("summarizes oversized responses", () => {
    expect(
      buildUserFacingFetchErrorSummary({
        error: "whatever",
        code: "response_too_large",
        phase: "loading",
      }),
    ).toBe("The response is larger than the maxResponseBytes limit.");
  });

  it("renders oversized-response errors with the limit and a suggested maxResponseBytes", () => {
    const output = buildFetchErrorResponseText({
      error:
        "Response body from https://example.com/data.json exceeds maxResponseBytes (1.00 MB); a truncated JSON document cannot be parsed.",
      code: "response_too_large",
      phase: "loading",
      retryable: false,
      url: "https://example.com/data.json",
      mimeType: "application/json",
      contentLength: 5_300_000,
      maxResponseBytes: 1024 * 1024,
    });

    expect(output).toContain("Error: Response body from");
    expect(output).toContain("> Phase: downloading the response body");
    expect(output).toContain("> Content-Length: 5300000 bytes (5.05 MB)");
    expect(output).toContain("> maxResponseBytes: 1048576 bytes (1.00 MB)");
    expect(output).toContain("> Suggested maxResponseBytes: 6291456");
    expect(output).toContain(
      "The maxResponseBytes parameter is configurable. Retry this call with a higher maxResponseBytes value.",
    );
  });
});

describe("metadata formatting", () => {
  const result: FetchResult = {
    kind: "content",
    url: "https://example.com/source",
    finalUrl: "https://example.com/final",
    title: "Example Article",
    author: "Ada Lovelace",
    published: "2026-04-10",
    site: "Example",
    language: "en",
    wordCount: 321,
    content: "content",
    browser: "chrome_145",
    os: "windows",
  };

  it("buildCompactMetadataHeader includes only the compact fields", () => {
    expect(buildCompactMetadataHeader(result)).toBe(
      [
        "> URL: https://example.com/final",
        "> Title: Example Article",
        "> Author: Ada Lovelace",
        "> Published: 2026-04-10",
      ].join("\n"),
    );
  });

  it("buildCompactMetadataHeader includes Content-Type when present", () => {
    const rawResult: FetchResult = {
      ...result,
      contentType: "text/html; charset=utf-8",
    };
    expect(buildCompactMetadataHeader(rawResult)).toBe(
      [
        "> URL: https://example.com/final",
        "> Title: Example Article",
        "> Author: Ada Lovelace",
        "> Published: 2026-04-10",
        "> Content-Type: text/html; charset=utf-8",
      ].join("\n"),
    );
  });

  it("buildMetadataHeader includes the full metadata surface", () => {
    expect(buildMetadataHeader(result)).toBe(
      [
        "> URL: https://example.com/final",
        "> Title: Example Article",
        "> Author: Ada Lovelace",
        "> Published: 2026-04-10",
        "> Site: Example",
        "> Language: en",
        "> Words: 321",
        "> Browser: chrome_145/windows",
      ].join("\n"),
    );
  });

  it("buildMetadataHeader includes Content-Type when present", () => {
    const rawResult: FetchResult = {
      ...result,
      contentType: "text/html; charset=utf-8",
    };
    expect(buildMetadataHeader(rawResult)).toBe(
      [
        "> URL: https://example.com/final",
        "> Title: Example Article",
        "> Author: Ada Lovelace",
        "> Published: 2026-04-10",
        "> Content-Type: text/html; charset=utf-8",
        "> Site: Example",
        "> Language: en",
        "> Words: 321",
        "> Browser: chrome_145/windows",
      ].join("\n"),
    );
  });

  it("reports a truncated response body in both metadata headers", () => {
    const truncatedResult: FetchResult = {
      ...result,
      responseTruncated: { bytesRead: 1024 * 1024, contentLength: 24_278_262 },
    };
    const line =
      "> Truncated: read the first 1.00 MB of 23.2 MB of the response body; raise maxResponseBytes to read more";

    expect(buildCompactMetadataHeader(truncatedResult)).toContain(line);
    expect(buildMetadataHeader(truncatedResult)).toContain(line);
    expect(
      buildCompactMetadataHeader({
        ...result,
        responseTruncated: { bytesRead: 65536 },
      }),
    ).toContain(
      "> Truncated: read the first 64.0 KB of the response body; raise maxResponseBytes to read more",
    );
  });

  it("buildFetchResponseText switches between compact and verbose output", () => {
    expect(buildFetchResponseText(result)).toBe(
      [
        "> URL: https://example.com/final",
        "> Title: Example Article",
        "> Author: Ada Lovelace",
        "> Published: 2026-04-10",
        "",
        "content",
      ].join("\n"),
    );
    expect(buildFetchResponseText(result, { verbose: true })).toContain(
      "> Browser: chrome_145/windows",
    );
  });

  it("buildFetchResponseText renders file download metadata without body content", () => {
    const fileResult: FetchResult = {
      kind: "file",
      url: "https://example.com/source.pdf",
      finalUrl: "https://example.com/final.pdf",
      title: "",
      author: "",
      published: "",
      site: "Example",
      language: "",
      wordCount: 0,
      content: "",
      browser: "chrome_145",
      os: "windows",
      filePath: "/tmp/example.pdf",
      fileSize: 42,
      mimeType: "application/pdf",
    };

    expect(buildFetchResponseText(fileResult)).toBe(
      [
        "> URL: https://example.com/final.pdf",
        "> File size: 42",
        "> Mime type: application/pdf",
        "> File path: /tmp/example.pdf",
      ].join("\n"),
    );
  });

  it("buildBatchFetchResponseText labels each item and preserves per-item errors", () => {
    const batchResult: BatchFetchResult = {
      items: [
        {
          index: 0,
          request: { url: "https://example.com/source" },
          status: "done",
          progress: 1,
          result,
        },
        {
          index: 1,
          request: { url: "https://bad.example/fail" },
          status: "error",
          progress: 1,
          error: "HTTP 403 Forbidden for https://bad.example/fail",
        },
      ],
      total: 2,
      succeeded: 1,
      failed: 1,
      batchConcurrency: 8,
    };

    const output = buildBatchFetchResponseText(batchResult, { verbose: true });
    expect(output).toContain("> Requests: 2");
    expect(output).toContain("> Concurrency: 8");
    expect(output).toContain("## [1/2] https://example.com/final");
    expect(output).toContain("## [2/2] https://bad.example/fail");
    expect(output).toContain(
      "> Error: HTTP 403 Forbidden for https://bad.example/fail",
    );
    expect(output).toContain("> Browser: chrome_145/windows");
  });
});
