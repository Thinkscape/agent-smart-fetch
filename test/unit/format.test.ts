import { describe, expect, it } from "bun:test";
import {
  buildMetadataHeader,
  markdownToText,
  truncateContent,
} from "../../src/format";
import type { FetchResult } from "../../src/types";

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

describe("truncateContent", () => {
  it("returns content unchanged when within limit", () => {
    expect(truncateContent("hello", 10)).toBe("hello");
  });

  it("adds a truncation marker when content exceeds max chars", () => {
    const output = truncateContent("abcdefghij", 5);
    expect(output).toBe("abcde\n\n[... truncated]");
  });
});

describe("buildMetadataHeader", () => {
  it("includes only populated metadata fields", () => {
    const result: FetchResult = {
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
});
