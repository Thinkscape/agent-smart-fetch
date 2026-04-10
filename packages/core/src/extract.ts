/**
 * Core extraction pipeline: fetch with TLS fingerprinting → parse → Defuddle extract.
 * Separated from the plugin entry so it can be tested independently.
 */

import {
  DEFAULT_ACCEPT_HEADER,
  DEFAULT_ACCEPT_LANGUAGE_HEADER,
  DEFAULT_BROWSER,
  DEFAULT_INCLUDE_REPLIES,
  DEFAULT_MAX_CHARS,
  DEFAULT_OS,
  DEFAULT_TIMEOUT_MS,
} from "./constants";
import { runtimeDependencies } from "./dependencies";
import { parseLinkedomHTML } from "./dom";
import { markdownToText, truncateContent } from "./format";
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
        Accept: DEFAULT_ACCEPT_HEADER,
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

    if (!HTML_CONTENT_TYPES.some((value) => contentType.includes(value))) {
      return { error: `Not an HTML page (content-type: ${contentType})` };
    }

    const html = await response.text();
    const document = parseLinkedomHTML(html, finalUrl);
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

    const normalizedContent =
      format === "text" ? markdownToText(extracted.content) : extracted.content;

    return {
      url: opts.url,
      finalUrl,
      title: extracted.title ?? "",
      author: extracted.author ?? "",
      published: extracted.published ?? "",
      site: extracted.site ?? "",
      language: extracted.language ?? "",
      wordCount: extracted.wordCount,
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
