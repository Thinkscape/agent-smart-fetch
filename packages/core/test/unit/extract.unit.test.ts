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

function createResponse({
  contentType = "text/html; charset=utf-8",
  body = "<html><body><article><h1>Hello</h1><p>World</p></article></body></html>",
  ...overrides
}: Partial<FetchResponseLike> & {
  contentType?: string;
  body?: string;
} = {}): FetchResponseLike {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    url: "https://example.com/final",
    headers: {
      get(name: string) {
        return name.toLowerCase() === "content-type" ? contentType : null;
      },
    },
    text: async () => body,
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

  it("builds default headers and timeout for HTML fetches", async () => {
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

  it("sends a JSON-focused Accept header when format=json", async () => {
    const dependencies = createDependencies({
      fetch: mock(async () =>
        createResponse({
          contentType: "application/json; charset=utf-8",
          body: '{"hello":"world"}',
        }),
      ),
    });
    const defuddleFetch = createDefuddleFetch(dependencies);

    await defuddleFetch({ url: "https://example.com/data", format: "json" });

    expect(dependencies.fetch).toHaveBeenCalledWith(
      "https://example.com/data",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: expect.stringContaining("application/json"),
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

  it("returns raw plain text bodies without invoking defuddle", async () => {
    const dependencies = createDependencies({
      fetch: mock(async () =>
        createResponse({
          contentType: "text/plain; charset=utf-8",
          body: "Line 1\n\nLine 2\n",
        }),
      ),
    });
    const defuddleFetch = createDefuddleFetch(dependencies);

    const result = await defuddleFetch({
      url: "https://example.com/file.txt",
      format: "text",
    });

    expect(isError(result)).toBe(false);
    expect(dependencies.defuddle).not.toHaveBeenCalled();
    if (!isError(result)) {
      expect(result.content).toBe("Line 1\n\nLine 2");
      expect(result.wordCount).toBe(4);
      expect(result.site).toBe("example.com");
    }
  });

  it("returns an error for unsupported non-HTML and non-JSON content types", async () => {
    const dependencies = createDependencies({
      fetch: mock(async () =>
        createResponse({
          contentType: "application/pdf",
          body: "%PDF-1.7",
        }),
      ),
    });
    const defuddleFetch = createDefuddleFetch(dependencies);

    const result = await defuddleFetch({
      url: "https://example.com/file.pdf",
    });

    expect(result).toEqual({
      error: "Not an HTML page (content-type: application/pdf)",
    });
    expect(dependencies.defuddle).not.toHaveBeenCalled();
  });

  it("returns an error when format=json does not receive JSON", async () => {
    const dependencies = createDependencies();
    const defuddleFetch = createDefuddleFetch(dependencies);

    const result = await defuddleFetch({
      url: "https://example.com/article",
      format: "json",
    });

    expect(result).toEqual({
      error: "Not a JSON response (content-type: text/html; charset=utf-8)",
    });
    expect(dependencies.defuddle).not.toHaveBeenCalled();
  });

  it("falls back to DOM text when defuddle finds no readable content", async () => {
    const dependencies = createDependencies({
      fetch: mock(async () =>
        createResponse({
          body: "<html><head><title>Simple</title></head><body><main><h1>Hello</h1><p>World</p></main></body></html>",
        }),
      ),
      defuddle: mock(
        async () => ({ content: "", wordCount: 0 }) satisfies ExtractedContent,
      ),
    });
    const defuddleFetch = createDefuddleFetch(dependencies);

    const result = await defuddleFetch({
      url: "https://example.com/simple",
      format: "text",
    });

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      expect(result.content).toContain("Hello");
      expect(result.content).toContain("World");
      expect(result.content).not.toContain("# Hello");
      expect(result.wordCount).toBeGreaterThan(0);
    }
  });

  it("converts DOM fallback content to markdown when format=markdown", async () => {
    const dependencies = createDependencies({
      fetch: mock(async () =>
        createResponse({
          body: '<html><body><main><h1>Hello</h1><p>Visit <a href="https://example.com">Example</a></p><ul><li>One</li><li>Two</li></ul></main></body></html>',
        }),
      ),
      defuddle: mock(
        async () => ({ content: "", wordCount: 0 }) satisfies ExtractedContent,
      ),
    });
    const defuddleFetch = createDefuddleFetch(dependencies);

    const result = await defuddleFetch({
      url: "https://example.com/simple",
      format: "markdown",
    });

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      expect(result.content).toContain("# Hello");
      expect(result.content).toContain("Visit [Example](https://example.com)");
      expect(result.content).toContain("- One");
      expect(result.content).toContain("- Two");
      expect(result.wordCount).toBeGreaterThan(0);
    }
  });

  it("uses the original DOM for fallback after defuddle mutates its working document", async () => {
    const body = `
      <html>
        <body>
          <div class="header"><h1>NeverSSL</h1></div>
          <div class="content"><noscript><h2>What?</h2><p>This website is for logging on.</p></noscript></div>
        </body>
      </html>
    `;
    const dependencies = createDependencies({
      fetch: mock(async () =>
        createResponse({
          body,
        }),
      ),
      defuddle: mock(async (document: Document) => {
        document.querySelectorAll("noscript").forEach((node) => {
          node.remove();
        });
        return { content: "", wordCount: 0 } satisfies ExtractedContent;
      }),
    });
    const defuddleFetch = createDefuddleFetch(dependencies);

    const result = await defuddleFetch({
      url: "https://example.com/mutated",
      format: "text",
    });

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      expect(result.content).toContain("NeverSSL");
      expect(result.content).toContain("What?");
      expect(result.content).toContain("This website is for logging on.");
      expect(result.wordCount).toBeGreaterThan(3);
    }
  });

  it("returns raw server html when DOM fallback is needed and format=html", async () => {
    const body =
      "<html><body><main><h1>Hello</h1><p>World</p></main></body></html>";
    const dependencies = createDependencies({
      fetch: mock(async () =>
        createResponse({
          body,
        }),
      ),
      defuddle: mock(
        async () => ({ content: "", wordCount: 0 }) satisfies ExtractedContent,
      ),
    });
    const defuddleFetch = createDefuddleFetch(dependencies);

    const result = await defuddleFetch({
      url: "https://example.com/simple",
      format: "html",
    });

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      expect(result.content).toBe(body);
      expect(result.wordCount).toBeGreaterThan(0);
    }
  });

  it("returns an error when extraction and DOM fallback both find no readable content", async () => {
    const dependencies = createDependencies({
      fetch: mock(async () =>
        createResponse({
          body: "<html><body></body></html>",
        }),
      ),
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

  it("emits coarse status updates while fetching and extracting", async () => {
    const dependencies = createDependencies();
    const defuddleFetch = createDefuddleFetch(dependencies);
    const statuses: string[] = [];

    const result = await defuddleFetch(
      { url: "https://example.com/article" },
      {
        onStatusChange(status) {
          statuses.push(status);
        },
      },
    );

    expect(isError(result)).toBe(false);
    expect(statuses).toEqual(["fetching", "extracting", "done"]);
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

  it("strips leaked extractor comments when includeReplies=false in markdown/text formats", async () => {
    const dependencies = createDependencies({
      defuddle: mock(
        async () =>
          ({
            content:
              "[Story](https://example.com)\n\n---\n\n## Comments\n\n> **alice**\n> hello",
            wordCount: 200,
            site: "Hacker News",
          }) satisfies ExtractedContent,
      ),
    });
    const defuddleFetch = createDefuddleFetch(dependencies);

    const result = await defuddleFetch({
      url: "https://news.ycombinator.com/item?id=1",
      format: "text",
      includeReplies: false,
    });

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      expect(result.content).toContain("Story");
      expect(result.content).not.toContain("Comments");
      expect(result.content).not.toContain("alice");
      expect(result.wordCount).toBeLessThan(200);
    }
  });

  it("strips leaked extractor comments when includeReplies=false in html mode", async () => {
    const dependencies = createDependencies({
      defuddle: mock(
        async () =>
          ({
            content:
              '<div class="hackernews post"><div class="post-content"><p>Story</p></div></div><hr><div class="hackernews comments"><h2>Comments</h2><div class="comment">Hello</div></div>',
            wordCount: 200,
            site: "Hacker News",
          }) satisfies ExtractedContent,
      ),
    });
    const defuddleFetch = createDefuddleFetch(dependencies);

    const result = await defuddleFetch({
      url: "https://news.ycombinator.com/item?id=1",
      format: "html",
      includeReplies: false,
    });

    expect(isError(result)).toBe(false);
    if (!isError(result)) {
      expect(result.content).toContain('<div class="hackernews post">');
      expect(result.content).not.toContain('<div class="hackernews comments">');
      expect(result.wordCount).toBeLessThan(200);
    }
  });

  it("returns pretty-printed JSON when format=json", async () => {
    const dependencies = createDependencies({
      fetch: mock(async () =>
        createResponse({
          contentType: "application/json; charset=utf-8",
          body: '{"hello":"world","count":2}',
        }),
      ),
    });
    const defuddleFetch = createDefuddleFetch(dependencies);

    const result = await defuddleFetch({
      url: "https://example.com/data",
      format: "json",
    });

    expect(isError(result)).toBe(false);
    expect(dependencies.defuddle).not.toHaveBeenCalled();
    if (!isError(result)) {
      expect(result.content).toBe('{\n  "hello": "world",\n  "count": 2\n}');
      expect(result.site).toBe("example.com");
    }
  });

  it("wraps JSON responses in a fenced code block for markdown mode", async () => {
    const dependencies = createDependencies({
      fetch: mock(async () =>
        createResponse({
          contentType: "application/json",
          body: '{"hello":"world"}',
        }),
      ),
    });
    const defuddleFetch = createDefuddleFetch(dependencies);

    const result = await defuddleFetch({
      url: "https://example.com/data",
      format: "markdown",
    });

    expect(isError(result)).toBe(false);
    expect(dependencies.defuddle).not.toHaveBeenCalled();
    if (!isError(result)) {
      expect(result.content).toBe('```json\n{\n  "hello": "world"\n}\n```');
    }
  });

  it("returns pretty-printed JSON as plain text for text mode", async () => {
    const dependencies = createDependencies({
      fetch: mock(async () =>
        createResponse({
          contentType: "application/json",
          body: '{"hello":"world"}',
        }),
      ),
    });
    const defuddleFetch = createDefuddleFetch(dependencies);

    const result = await defuddleFetch({
      url: "https://example.com/data",
      format: "text",
    });

    expect(isError(result)).toBe(false);
    expect(dependencies.defuddle).not.toHaveBeenCalled();
    if (!isError(result)) {
      expect(result.content).toBe('{\n  "hello": "world"\n}');
    }
  });

  it("wraps JSON responses in HTML code markup for html mode", async () => {
    const dependencies = createDependencies({
      fetch: mock(async () =>
        createResponse({
          contentType: "application/json",
          body: '{"hello":"<world>"}',
        }),
      ),
    });
    const defuddleFetch = createDefuddleFetch(dependencies);

    const result = await defuddleFetch({
      url: "https://example.com/data",
      format: "html",
    });

    expect(isError(result)).toBe(false);
    expect(dependencies.defuddle).not.toHaveBeenCalled();
    if (!isError(result)) {
      expect(result.content).toBe(
        '<pre><code class="language-json">{\n  &quot;hello&quot;: &quot;&lt;world&gt;&quot;\n}</code></pre>',
      );
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
