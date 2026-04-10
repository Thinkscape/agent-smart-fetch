/**
 * Core extraction pipeline: fetch with TLS fingerprinting → parse → Defuddle extract.
 * Separated from the plugin entry so it can be tested independently.
 */

import {
  DEFAULT_ACCEPT_HEADER,
  DEFAULT_ACCEPT_LANGUAGE_HEADER,
  DEFAULT_BROWSER,
  DEFAULT_INCLUDE_REPLIES,
  DEFAULT_JSON_ACCEPT_HEADER,
  DEFAULT_MAX_CHARS,
  DEFAULT_OS,
  DEFAULT_TIMEOUT_MS,
} from "./constants";
import { runtimeDependencies } from "./dependencies";
import { parseLinkedomHTML } from "./dom";
import {
  estimateWordCount,
  markdownToText,
  parseAndFormatJson,
  renderJsonContent,
  stripExtractorComments,
  truncateContent,
} from "./format";
import { getLatestChromeProfile as getLatestChromeProfileFrom } from "./profiles";
import type {
  FetchDependencies,
  FetchError,
  FetchExecutionHooks,
  FetchOptions,
  FetchResult,
  OutputFormat,
} from "./types";

export {
  DEFAULT_BATCH_CONCURRENCY,
  DEFAULT_BROWSER,
  DEFAULT_INCLUDE_REPLIES,
  DEFAULT_MAX_CHARS,
  DEFAULT_OS,
  DEFAULT_TIMEOUT_MS,
} from "./constants";
export type {
  FetchError,
  FetchOptions,
  FetchResult,
  OutputFormat,
} from "./types";

const HTML_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "text/markdown",
];

function normalizeContentType(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isPlainTextContentType(contentType: string): boolean {
  const normalized = normalizeContentType(contentType);
  return normalized === "text/plain" || normalized === "text/markdown";
}

function renderPlainTextContent(body: string, format: OutputFormat): string {
  if (format === "html") {
    return `<pre>${body
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")}</pre>`;
  }

  return body;
}

function buildPlainTextResult(
  opts: FetchOptions,
  finalUrl: string,
  rawBody: string,
  format: OutputFormat,
  maxChars: number,
  browser: string,
  os: string,
): FetchResult {
  const normalizedBody = rawBody.replace(/\r\n/g, "\n").trim();
  return {
    url: opts.url,
    finalUrl,
    title: "",
    author: "",
    published: "",
    site: new URL(finalUrl).hostname,
    language: "",
    wordCount: estimateWordCount(normalizedBody),
    content: truncateContent(
      renderPlainTextContent(normalizedBody, format),
      maxChars,
    ),
    browser,
    os,
  };
}

function extractDomTextFallback(document: Document): string {
  const bodyText =
    document.body?.textContent ?? document.documentElement?.textContent ?? "";
  return bodyText
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+-.!|>])/g, "\\$1");
}

function normalizeInlineWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function renderInlineMarkdown(node: Node): string {
  if (node.nodeType === 3) {
    return normalizeInlineWhitespace(node.textContent ?? "");
  }

  if (node.nodeType !== 1) {
    return "";
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();

  if (["script", "style", "meta", "link"].includes(tag)) {
    return "";
  }

  if (tag === "br") {
    return "  \n";
  }

  if (tag === "code") {
    const content = normalizeInlineWhitespace(element.textContent ?? "");
    return content ? `\`${content}\`` : "";
  }

  if (tag === "img") {
    const alt = element.getAttribute("alt") ?? "";
    const src = element.getAttribute("src") ?? "";
    return src ? `![${escapeMarkdownText(alt)}](${src})` : "";
  }

  const childContent = Array.from(element.childNodes)
    .map(renderInlineMarkdown)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (tag === "a") {
    const href = element.getAttribute("href") ?? "";
    if (!href) return childContent;
    return `[${childContent || href}](${href})`;
  }

  if (["strong", "b"].includes(tag)) {
    return childContent ? `**${childContent}**` : "";
  }

  if (["em", "i"].includes(tag)) {
    return childContent ? `*${childContent}*` : "";
  }

  return childContent;
}

function renderBlockMarkdown(node: Node, depth = 0): string {
  if (node.nodeType === 3) {
    const text = normalizeInlineWhitespace(node.textContent ?? "");
    return text ? `${text}\n\n` : "";
  }

  if (node.nodeType !== 1) {
    return "";
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();

  if (["script", "style", "meta", "link"].includes(tag)) {
    return "";
  }

  if (/^h[1-6]$/.test(tag)) {
    const level = Number.parseInt(tag.slice(1), 10);
    const content = Array.from(element.childNodes)
      .map(renderInlineMarkdown)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return content ? `${"#".repeat(level)} ${content}\n\n` : "";
  }

  if (tag === "p") {
    const content = Array.from(element.childNodes)
      .map(renderInlineMarkdown)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return content ? `${content}\n\n` : "";
  }

  if (tag === "pre") {
    const content = (element.textContent ?? "").trim();
    return content ? `\`\`\`\n${content}\n\`\`\`\n\n` : "";
  }

  if (tag === "blockquote") {
    const content = Array.from(element.childNodes)
      .map((child) => renderBlockMarkdown(child, depth))
      .join("")
      .trim();
    if (!content) return "";
    return `${content
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n")}\n\n`;
  }

  if (tag === "ul" || tag === "ol") {
    const items = Array.from(element.children)
      .filter((child) => child.tagName.toLowerCase() === "li")
      .map((child, index) => {
        const prefix = tag === "ol" ? `${index + 1}. ` : "- ";
        const content = Array.from(child.childNodes)
          .map((grandchild) => {
            const childTag =
              grandchild.nodeType === 1
                ? (grandchild as Element).tagName.toLowerCase()
                : "";
            return childTag === "ul" || childTag === "ol"
              ? `\n${renderBlockMarkdown(grandchild, depth + 1)}`
              : renderInlineMarkdown(grandchild);
          })
          .join(" ")
          .replace(/\s+\n/g, "\n")
          .replace(/\n\s+/g, "\n")
          .replace(/\s+/g, " ")
          .trim();
        if (!content) return "";
        const indented = content
          .split("\n")
          .map((line, lineIndex) =>
            lineIndex === 0
              ? `${"  ".repeat(depth)}${prefix}${line}`
              : `${"  ".repeat(depth + 1)}${line}`,
          )
          .join("\n");
        return indented;
      })
      .filter(Boolean)
      .join("\n");
    return items ? `${items}\n\n` : "";
  }

  if (tag === "hr") {
    return "---\n\n";
  }

  const blockContent = Array.from(element.childNodes)
    .map((child) => renderBlockMarkdown(child, depth))
    .join("");

  if (blockContent.trim()) {
    return blockContent;
  }

  const inlineContent = Array.from(element.childNodes)
    .map(renderInlineMarkdown)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return inlineContent ? `${inlineContent}\n\n` : "";
}

function extractDomMarkdownFallback(document: Document): string {
  const root = document.body ?? document.documentElement;
  if (!root) return "";

  return Array.from(root.childNodes)
    .map((node) => renderBlockMarkdown(node))
    .join("")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function resolveAcceptHeader(format: OutputFormat): string {
  return format === "json" ? DEFAULT_JSON_ACCEPT_HEADER : DEFAULT_ACCEPT_HEADER;
}

function isJsonContentType(contentType: string): boolean {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    normalized === "application/json" ||
    normalized === "text/json" ||
    normalized.endsWith("+json")
  );
}

function isLikelyJsonBody(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function isJsonResponse(contentType: string, body: string): boolean {
  return isJsonContentType(contentType) || isLikelyJsonBody(body);
}

function buildJsonResult(
  opts: FetchOptions,
  finalUrl: string,
  rawBody: string,
  format: OutputFormat,
  maxChars: number,
  browser: string,
  os: string,
): FetchResult | FetchError {
  const parsedJson = parseAndFormatJson(rawBody);

  if ("error" in parsedJson) {
    return parsedJson;
  }

  const content = truncateContent(
    renderJsonContent(parsedJson.formatted, format),
    maxChars,
  );

  return {
    url: opts.url,
    finalUrl,
    title: "",
    author: "",
    published: "",
    site: new URL(finalUrl).hostname,
    language: "",
    wordCount: estimateWordCount(parsedJson.formatted),
    content,
    browser,
    os,
  };
}

function shouldStripReplies(site: string): boolean {
  return (
    site === "Hacker News" ||
    site.startsWith("r/") ||
    site.startsWith("GitHub - ")
  );
}

export function getLatestChromeProfile(): string {
  return getLatestChromeProfileFrom(runtimeDependencies.getProfiles);
}

export function createDefuddleFetch(
  dependencies: FetchDependencies = runtimeDependencies,
) {
  return async function defuddleFetch(
    opts: FetchOptions,
    hooks: FetchExecutionHooks = {},
  ): Promise<FetchResult | FetchError> {
    const browser = opts.browser ?? DEFAULT_BROWSER;
    const os = opts.os ?? DEFAULT_OS;
    const format: OutputFormat = opts.format ?? "markdown";
    const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
    const removeImages = opts.removeImages ?? false;
    const includeReplies = opts.includeReplies ?? DEFAULT_INCLUDE_REPLIES;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let parsed: URL;
    try {
      parsed = new URL(opts.url);
    } catch {
      return { error: `Invalid URL: ${opts.url}` };
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return {
        error: `Only http/https URLs supported, got ${parsed.protocol}`,
      };
    }

    const fetchOptions: Record<string, unknown> = {
      browser,
      os,
      headers: {
        Accept: resolveAcceptHeader(format),
        "Accept-Language": DEFAULT_ACCEPT_LANGUAGE_HEADER,
        ...opts.headers,
      },
      redirect: "follow",
      timeout: timeoutMs,
    };

    if (opts.proxy) {
      fetchOptions.proxy = opts.proxy;
    }

    hooks.onStatusChange?.("fetching");
    const response = await dependencies.fetch(opts.url, fetchOptions);

    if (!response.ok) {
      return {
        error: `HTTP ${response.status} ${response.statusText} for ${opts.url}`,
      };
    }

    const finalUrl = response.url ?? opts.url;
    const contentType = response.headers.get("content-type") ?? "";
    const rawBody = await response.text();
    const jsonResponse = isJsonResponse(contentType, rawBody);

    if (format === "json") {
      if (!jsonResponse) {
        return { error: `Not a JSON response (content-type: ${contentType})` };
      }

      const result = buildJsonResult(
        opts,
        finalUrl,
        rawBody,
        format,
        maxChars,
        browser,
        os,
      );
      if (!isError(result)) {
        hooks.onStatusChange?.("done");
      }
      return result;
    }

    if (jsonResponse) {
      const result = buildJsonResult(
        opts,
        finalUrl,
        rawBody,
        format,
        maxChars,
        browser,
        os,
      );
      if (!isError(result)) {
        hooks.onStatusChange?.("done");
      }
      return result;
    }

    if (isPlainTextContentType(contentType)) {
      const result = buildPlainTextResult(
        opts,
        finalUrl,
        rawBody,
        format,
        maxChars,
        browser,
        os,
      );
      hooks.onStatusChange?.("done");
      return result;
    }

    if (!HTML_CONTENT_TYPES.some((value) => contentType.includes(value))) {
      return { error: `Not an HTML page (content-type: ${contentType})` };
    }

    hooks.onStatusChange?.("extracting");
    const document = parseLinkedomHTML(rawBody, finalUrl);
    const extracted = await dependencies.defuddle(document, finalUrl, {
      markdown: format !== "html",
      removeImages,
      includeReplies,
    });

    let extractedContent = extracted.content;
    let wordCount = extracted.wordCount;

    if (!extractedContent || wordCount === 0) {
      const fallbackText = extractDomTextFallback(document);
      if (!fallbackText) {
        return {
          error: `No content extracted from ${opts.url}. May need JS rendering or is blocked.`,
        };
      }

      extractedContent =
        format === "html"
          ? rawBody
          : format === "markdown"
            ? extractDomMarkdownFallback(document) || fallbackText
            : fallbackText;
      wordCount = estimateWordCount(fallbackText);
    }

    if (includeReplies === false && shouldStripReplies(extracted.site ?? "")) {
      const strippedContent = stripExtractorComments(extractedContent, format);
      if (strippedContent !== extractedContent) {
        extractedContent = strippedContent;
        wordCount = estimateWordCount(
          format === "text"
            ? markdownToText(extractedContent)
            : extractedContent,
        );
      }
    }

    const normalizedContent =
      format === "text" ? markdownToText(extractedContent) : extractedContent;

    const result = {
      url: opts.url,
      finalUrl,
      title: extracted.title ?? "",
      author: extracted.author ?? "",
      published: extracted.published ?? "",
      site: extracted.site ?? "",
      language: extracted.language ?? "",
      wordCount,
      content: truncateContent(normalizedContent, maxChars),
      browser,
      os,
    };

    hooks.onStatusChange?.("done");
    return result;
  };
}

export const defuddleFetch = createDefuddleFetch();

/** Type guard: check if result is an error. */
export function isError(
  result: FetchResult | FetchError,
): result is FetchError {
  return "error" in result;
}
