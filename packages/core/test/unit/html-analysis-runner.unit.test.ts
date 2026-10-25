import { describe, expect, it } from "bun:test";
import { analyzeHtmlInWorker } from "../../src/html-analysis-runner";

describe("analyzeHtmlInWorker", () => {
  it("returns document signals without running Defuddle when no extraction is requested", async () => {
    const analysis = await analyzeHtmlInWorker(
      {
        html: '<html><head><link rel="alternate" type="application/json" href="/page.json"></head><body><p>Hello</p></body></html>',
        url: "https://example.com/page",
        requestUrl: "https://example.com/page",
        format: "json",
      },
      { timeoutMs: 10_000 },
    );

    expect(analysis).toEqual({
      alternateLinks: ["https://example.com/page.json"],
      isXJsDisabledShell: false,
    });
  });

  it("rejects promptly with the worker's error when the analysis throws", async () => {
    const started = performance.now();
    // A non-string body makes the HTML parser throw inside the worker.
    const outcome = await analyzeHtmlInWorker(
      {
        html: 42 as unknown as string,
        url: "https://example.com/page",
        requestUrl: "https://example.com/page",
        format: "markdown",
      },
      { timeoutMs: 30_000 },
    ).then(
      () => "resolved",
      (error: unknown) => (error instanceof Error ? error.message : "?"),
    );

    expect(outcome).not.toBe("resolved");
    expect(outcome).not.toContain("timed out");
    expect(performance.now() - started).toBeLessThan(10_000);
  });

  it("treats a zero timeout as no time limit, like the network timeout", async () => {
    const analysis = await analyzeHtmlInWorker(
      {
        html: "<html><head><title>t</title></head><body><p>Hello</p></body></html>",
        url: "https://example.com/page",
        requestUrl: "https://example.com/page",
        format: "markdown",
      },
      { timeoutMs: 0 },
    );

    expect(analysis.alternateLinks).toEqual([]);
  });
});
