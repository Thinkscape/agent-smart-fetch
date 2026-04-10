import { describe, expect, it } from "bun:test";
import {
  DEFAULT_BROWSER,
  DEFAULT_OS,
  defuddleFetch,
  getLatestChromeProfile,
  isError,
} from "../../src/extract";

const TIMEOUT = 30_000;
const shouldRun = process.env.RUN_INTEGRATION === "1";
const describeIf = shouldRun ? describe : describe.skip;

const TEST_URLS = {
  cloudflare: "https://www.cloudflare.com",
  nextjs: "https://nextjs.org/docs",
  httpbinHtml: "https://httpbin.org/html",
  httpbinJson: "https://httpbin.org/json",
  browserLeaks: "https://tls.browserleaks.com/json",
  rfc9110Text: "https://www.rfc-editor.org/rfc/rfc9110.txt",
  neverSsl: "http://neverssl.com",
};

describeIf("integration: extraction pipeline", () => {
  it("discovers a recent chrome profile", () => {
    const profile = getLatestChromeProfile();
    expect(profile).toMatch(/^chrome_\d+$/);
  });

  it(
    "supports JSON responses in format=json against a live endpoint",
    async () => {
      const result = await defuddleFetch({
        url: TEST_URLS.httpbinJson,
        format: "json",
      });

      expect(isError(result)).toBe(false);
      if (!isError(result)) {
        expect(result.content).toContain('"slideshow"');
        expect(result.content).toContain('"title"');
      }
    },
    TIMEOUT,
  );

  it(
    "supports JSON responses in markdown mode against a live endpoint",
    async () => {
      const result = await defuddleFetch({
        url: TEST_URLS.httpbinJson,
        format: "markdown",
      });

      expect(isError(result)).toBe(false);
      if (!isError(result)) {
        expect(result.content).toContain("```json");
        expect(result.content).toContain('"slideshow"');
      }
    },
    TIMEOUT,
  );

  it(
    "extracts readable content from a documentation site",
    async () => {
      const result = await defuddleFetch({ url: TEST_URLS.nextjs });

      expect(isError(result)).toBe(false);
      if (!isError(result)) {
        expect(result.wordCount).toBeGreaterThan(100);
        expect(result.title).toContain("Next.js");
        expect(result.content.length).toBeGreaterThan(100);
      }
    },
    TIMEOUT,
  );

  it(
    "returns plain text content for live text/plain resources",
    async () => {
      const result = await defuddleFetch({
        url: TEST_URLS.rfc9110Text,
        format: "text",
        maxChars: 2000,
      });

      expect(isError(result)).toBe(false);
      if (!isError(result)) {
        expect(result.site).toBe("www.rfc-editor.org");
        expect(result.wordCount).toBeGreaterThan(1000);
        expect(result.content).toContain("Request for Comments: 9110");
      }
    },
    TIMEOUT,
  );

  it(
    "documents current live behavior for neverssl.com",
    async () => {
      const result = await defuddleFetch({
        url: TEST_URLS.neverSsl,
        format: "text",
        maxChars: 2000,
      });

      if (isError(result)) {
        expect(result.error).toMatch(
          /timed out|No content extracted|HTTP \d+/i,
        );
        return;
      }

      expect(result.content).toContain("NeverSSL");
      expect(result.wordCount).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    "supports alternate browser fingerprints against a real HTML page",
    async () => {
      const result = await defuddleFetch({
        url: TEST_URLS.httpbinHtml,
        browser: DEFAULT_BROWSER,
        os: DEFAULT_OS,
        format: "text",
      });

      expect(isError(result)).toBe(false);
      if (!isError(result)) {
        expect(result.browser).toBe(DEFAULT_BROWSER);
        expect(result.os).toBe(DEFAULT_OS);
        expect(result.content).not.toMatch(/^#{1,6}\s/m);
      }
    },
    TIMEOUT,
  );

  it(
    "extracts and truncates homepage content",
    async () => {
      const result = await defuddleFetch({
        url: TEST_URLS.cloudflare,
        maxChars: 500,
      });

      expect(isError(result)).toBe(false);
      if (!isError(result)) {
        expect(result.content).toContain("[... truncated]");
        expect(result.content.length).toBeLessThanOrEqual(520);
      }
    },
    TIMEOUT,
  );

  it(
    "presents a browser-like TLS fingerprint",
    async () => {
      const { fetch } = await import("wreq-js");
      const response = await fetch(TEST_URLS.browserLeaks, {
        browser: DEFAULT_BROWSER,
        os: DEFAULT_OS,
      });
      const data = (await response.json()) as {
        user_agent: string;
        ja3_hash: string;
      };

      expect(data.user_agent).toContain("Chrome/");
      expect(data.ja3_hash.length).toBeGreaterThan(10);
    },
    TIMEOUT,
  );
});
