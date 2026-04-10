import { type TSchema, Type } from "@sinclair/typebox";
import {
  DEFAULT_BROWSER,
  DEFAULT_INCLUDE_REPLIES,
  DEFAULT_MAX_CHARS,
  DEFAULT_OS,
  DEFAULT_TIMEOUT_MS,
} from "./constants";
import { defuddleFetch } from "./extract";
import type {
  FetchError,
  FetchResult,
  FetchToolConfig,
  FetchToolDefaults,
} from "./types";

export function resolveFetchToolDefaults(
  config: FetchToolConfig = {},
): FetchToolDefaults {
  return {
    maxChars: config.maxChars ?? DEFAULT_MAX_CHARS,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    browser: config.browser ?? DEFAULT_BROWSER,
    os: config.os ?? DEFAULT_OS,
    removeImages: config.removeImages ?? false,
    includeReplies: config.includeReplies ?? DEFAULT_INCLUDE_REPLIES,
  };
}

export function createBaseFetchToolParameterProperties(
  defaults: FetchToolDefaults,
): Record<string, TSchema> {
  return {
    url: Type.String({ description: "URL to fetch (http/https only)" }),
    browser: Type.Optional(
      Type.String({
        description: `Browser profile for TLS fingerprinting. Default: "${defaults.browser}". Examples: chrome_145, firefox_147, safari_26, edge_145, opera_127`,
      }),
    ),
    os: Type.Optional(
      Type.String({
        description: `OS profile for fingerprinting. Default: "${defaults.os}". Options: windows, macos, linux, android, ios`,
      }),
    ),
    headers: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description:
          "Custom HTTP headers to send. By default, Accept and Accept-Language are set automatically.",
      }),
    ),
    maxChars: Type.Optional(
      Type.Number({
        description: `Maximum characters to return. Default: ${defaults.maxChars}`,
      }),
    ),
    format: Type.Optional(
      Type.Union(
        [
          Type.Literal("markdown"),
          Type.Literal("html"),
          Type.Literal("text"),
          Type.Literal("json"),
        ],
        {
          description:
            'Output format. "markdown" (default), "html" (cleaned HTML), "text" (plain text, no formatting), or "json" (pretty-printed JSON)',
        },
      ),
    ),
    removeImages: Type.Optional(
      Type.Boolean({
        description: "Strip image references from output. Default: false",
      }),
    ),
    includeReplies: Type.Optional(
      Type.Union([Type.Boolean(), Type.Literal("extractors")], {
        description:
          "Include replies/comments: 'extractors' for site-specific only (default), true for all, false for none",
      }),
    ),
    proxy: Type.Optional(
      Type.String({
        description:
          "Proxy URL (http://user:pass@host:port or socks5://host:port)",
      }),
    ),
  };
}

export async function executeFetchToolCall(
  params: Record<string, unknown>,
  defaults: FetchToolDefaults,
): Promise<FetchResult | FetchError> {
  return defuddleFetch({
    url: params.url as string,
    browser: (params.browser as string) ?? defaults.browser,
    os: (params.os as string) ?? defaults.os,
    headers: params.headers as Record<string, string> | undefined,
    maxChars: (params.maxChars as number) ?? defaults.maxChars,
    format:
      (params.format as "markdown" | "html" | "text" | "json") ?? "markdown",
    removeImages: (params.removeImages as boolean) ?? defaults.removeImages,
    includeReplies:
      (params.includeReplies as boolean | "extractors") ??
      defaults.includeReplies,
    proxy: params.proxy as string | undefined,
    timeoutMs: defaults.timeoutMs,
  });
}
