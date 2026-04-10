/**
 * OpenClaw plugin entry — registers defuddle_fetch tool.
 * Uses inline registration pattern compatible with jiti loading.
 */

import { Type } from "@sinclair/typebox";
import {
  DEFAULT_BROWSER,
  DEFAULT_INCLUDE_REPLIES,
  DEFAULT_MAX_CHARS,
  DEFAULT_OS,
  DEFAULT_TIMEOUT_MS,
} from "./src/extract";
import { buildMetadataHeader } from "./src/format";
import type {
  FetchResult,
  PluginConfig,
  ToolRegistrationApi,
} from "./src/types";

export function resolvePluginDefaults(pluginConfig: PluginConfig = {}) {
  return {
    maxChars: pluginConfig.maxChars ?? DEFAULT_MAX_CHARS,
    timeoutMs: pluginConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    browser: pluginConfig.browser ?? DEFAULT_BROWSER,
    os: pluginConfig.os ?? DEFAULT_OS,
    removeImages: pluginConfig.removeImages ?? false,
    includeReplies: pluginConfig.includeReplies ?? DEFAULT_INCLUDE_REPLIES,
  };
}

function renderToolResponse(result: FetchResult) {
  const metaHeader = buildMetadataHeader(result);
  return {
    content: [
      { type: "text" as const, text: `${metaHeader}\n\n${result.content}` },
    ],
  };
}

const plugin = {
  id: "defuddle-fetch",
  name: "Defuddle Fetch",
  description:
    "Clean web content extraction with TLS fingerprinting. Uses wreq-js (Rust native bindings) for browser-grade TLS and Defuddle for extraction.",

  register(api: ToolRegistrationApi) {
    const defaults = resolvePluginDefaults(api.pluginConfig);

    api.registerTool({
      name: "defuddle_fetch",
      description: [
        "Fetch a URL with browser-grade TLS fingerprinting and extract clean, readable content.",
        "Uses Rust native bindings to impersonate real browsers at the TLS/HTTP2 level (JA3/JA4 match).",
        "Returns markdown with rich metadata (author, publish date, schema.org data).",
        "Better noise removal and anti-bot bypass than web_fetch.",
        "Does NOT execute JavaScript — use the browser tool for JS-heavy SPAs.",
      ].join(" "),
      parameters: Type.Object({
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
            ],
            {
              description:
                'Output format. "markdown" (default), "html" (cleaned HTML), or "text" (plain text, no formatting)',
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
      }),

      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const { defuddleFetch, isError } = await import("./src/extract");

        const result = await defuddleFetch({
          url: params.url as string,
          browser: (params.browser as string) ?? defaults.browser,
          os: (params.os as string) ?? defaults.os,
          headers: params.headers as Record<string, string> | undefined,
          maxChars: (params.maxChars as number) ?? defaults.maxChars,
          format: (params.format as "markdown" | "html" | "text") ?? "markdown",
          removeImages:
            (params.removeImages as boolean) ?? defaults.removeImages,
          includeReplies:
            (params.includeReplies as boolean | "extractors") ??
            defaults.includeReplies,
          proxy: params.proxy as string | undefined,
          timeoutMs: defaults.timeoutMs,
        });

        if (isError(result)) {
          return {
            content: [
              { type: "text" as const, text: `Error: ${result.error}` },
            ],
            isError: true,
          };
        }

        return renderToolResponse(result);
      },
    });

    api.logger.info(
      `defuddle_fetch tool registered (default: ${defaults.browser}/${defaults.os})`,
    );
  },
};

export default plugin;
