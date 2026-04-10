import { describe, expect, it, mock } from "bun:test";
import {
  createDefuddleFetch,
  getLatestChromeProfile,
  isError,
} from "../../src/extract";
import type {
  ExtractedContent,
  FetchDependencies,
  FetchResponseLike,
} from "../../src/types";

function createResponse(
  overrides: Partial<FetchResponseLike> = {},
): FetchResponseLike {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    url: "https://example.com/final",
    headers: {
      get(name: string) {
        return name.toLowerCase() === "content-type"
          ? "text/html; charset=utf-8"
          : null;
      },
    },
    text: async () =>
      "<html><body><article><h1>Hello</h1><p>World</p></article></body></html>",
    ...overrides,
  };
}

function createDependencies(
  overrides: Partial<FetchDependencies> = {},
): FetchDependencies {
  return {
    fetch: mock(async () => createResponse()),
    defuddle: mock(
      async () =>
        ({
          content: "# Hello\n\nWorld",
          wordCount: 2,
          title: "Hello",
          author: "",
          published: "",
          site: "",
          language: "en",
        }) satisfies ExtractedContent,
    ),
    getProfiles: () => ["chrome_140", "chrome_145", "firefox_147"],
    ...overrides,
  };
}

describe("createDefuddleFetch", () => {
  it("rejects invalid URLs before making any network request", async () => {
    const dependencies = createDependencies();
    const defuddleFetch = createDefuddleFetch(dependencies);

    const result = await defuddleFetch({ url: "not-a-url" });

    expect(isError(result)).toBe(true);
    expect(dependencies.fetch).not.toHaveBeenCalled();
  });

  it("builds default headers and timeout for fetch", async () => {
    const dependencies = createDependencies();
    const defuddleFetch = createDefuddleFetch(dependencies);

    await defuddleFetch({ url: "https://example.com/article" });

    expect(dependencies.fetch).toHaveBeenCalledWith(
      "https://example.com/article",
      expect.objectContaining({
        browser: "chrome_145",
        os: "windows",
        redirect: "follow",
        timeout: 15000,
        headers: expect.objectContaining({
          Accept: expect.stringContaining("text/html"),
          "Accept-Language": "en-US,en;q=0.9",
        }),
      }),
    );
  });

  it("merges custom headers and proxy options", async () => {
    const dependencies = createDependencies();
    const defuddleFetch = createDefuddleFetch(dependencies);

    await defuddleFetch({
      url: "https://example.com/article",
      headers: { Authorization: "Bearer token" },
      proxy: "socks5://proxy.internal:1080",
      browser: "firefox_147",
      os: "linux",
    });

    expect(dependencies.fetch).toHaveBeenCalledWith(
      "https://example.com/article",
      expect.objectContaining({
        browser: "firefox_147",
        os: "linux",
        proxy: "socks5://proxy.internal:1080",
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
      }),
    );
  });

  it("returns an error for non-html content types", async () => {
    const dependencies = createDependencies({
      fetch: mock(async () =>
        createResponse({
          headers: {
            get: () => "application/json",
          },
        }),
      ),
    });
    const defuddleFetch = createDefuddleFetch(dependencies);

    const result = await defuddleFetch({
      url: "https://example.com/data.json",
    });

    expect(result).toEqual({
      error: "Not an HTML page (content-type: application/json)",
    });
    expect(dependencies.defuddle).not.toHaveBeenCalled();
  });

  it("returns an error when extraction finds no readable content", async () => {
    const dependencies = createDependencies({
      defuddle: mock(
        async () => ({ content: "", wordCount: 0 }) satisfies ExtractedContent,
      ),
    });
    const defuddleFetch = createDefuddleFetch(dependencies);

    const result = await defuddleFetch({ url: "https://example.com/empty" });

    expect(result).toEqual({
      error:
        "No content extracted from https://example.com/empty. May need JS rendering or is blocked.",
    });
  });

  it("converts markdown output to plain text when format=text", async () => {
    const dependencies = createDependencies({
      defuddle: mock(
        async () =>
          ({
            content: "# Heading\n\n**Bold** [Link](https://example.com)",
            wordCount: 3,
          }) satisfies ExtractedContent,
      ),
    });
    const defuddleFetch = createDefuddleFetch(dependencies);

    const result = await defuddleFetch({
      url: "https://example.com/article",
      format: "text",
    });

    expect(dependencies.defuddle).toHaveBeenCalledWith(
      expect.anything(),
      "https://example.com/final",
      expect.objectContaining({ markdown: true }),
    );
    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      expect(result.content).toContain("Heading");
      expect(result.content).toContain("Bold Link");
      expect(result.content).not.toContain("# ");
      expect(result.content).not.toContain("[");
    }
  });

  it("preserves cleaned HTML output when format=html", async () => {
    const dependencies = createDependencies({
      defuddle: mock(
        async () =>
          ({
            content:
              "<article><h1>Hello</h1><p><strong>World</strong></p></article>",
            wordCount: 2,
          }) satisfies ExtractedContent,
      ),
    });
    const defuddleFetch = createDefuddleFetch(dependencies);

    const result = await defuddleFetch({
      url: "https://example.com/article",
      format: "html",
    });

    expect(dependencies.defuddle).toHaveBeenCalledWith(
      expect.anything(),
      "https://example.com/final",
      expect.objectContaining({ markdown: false }),
    );
    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      expect(result.content).toBe(
        "<article><h1>Hello</h1><p><strong>World</strong></p></article>",
      );
      expect(result.content).toContain("<strong>");
    }
  });

  it("truncates extracted content to maxChars", async () => {
    const dependencies = createDependencies({
      defuddle: mock(
        async () =>
          ({
            content: "abcdefghijklmnopqrstuvwxyz",
            wordCount: 5,
          }) satisfies ExtractedContent,
      ),
    });
    const defuddleFetch = createDefuddleFetch(dependencies);

    const result = await defuddleFetch({
      url: "https://example.com/article",
      maxChars: 10,
    });

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      expect(result.content).toBe("abcdefghij\n\n[... truncated]");
    }
  });
});

describe("getLatestChromeProfile", () => {
  it("returns the highest available chrome profile", () => {
    const profile = getLatestChromeProfile();
    expect(profile).toMatch(/^chrome_\d+$/);
  });
});
