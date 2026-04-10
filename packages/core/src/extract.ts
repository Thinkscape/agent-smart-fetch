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
  FetchOptions,
  FetchResult,
  OutputFormat,
} from "./types";

export {
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

      return buildJsonResult(
        opts,
        finalUrl,
        rawBody,
        format,
        maxChars,
        browser,
        os,
      );
    }

    if (jsonResponse) {
      return buildJsonResult(
        opts,
        finalUrl,
        rawBody,
        format,
        maxChars,
        browser,
        os,
      );
    }

    if (!HTML_CONTENT_TYPES.some((value) => contentType.includes(value))) {
      return { error: `Not an HTML page (content-type: ${contentType})` };
    }

    const document = parseLinkedomHTML(rawBody, finalUrl);
    const extracted = await dependencies.defuddle(document, finalUrl, {
      markdown: format !== "html",
      removeImages,
      includeReplies,
    });

    if (!extracted.content || extracted.wordCount === 0) {
      return {
        error: `No content extracted from ${opts.url}. May need JS rendering or is blocked.`,
      };
    }

    let extractedContent = extracted.content;
    let wordCount = extracted.wordCount;

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

    return {
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
  };
}

export const defuddleFetch = createDefuddleFetch();

/** Type guard: check if result is an error. */
export function isError(
  result: FetchResult | FetchError,
): result is FetchError {
  return "error" in result;
}
