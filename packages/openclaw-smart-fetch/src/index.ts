import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import {
  buildBatchFetchResponseText,
  buildFetchErrorResponseText,
  buildFetchResponseText,
  createBaseFetchToolParameterProperties,
  createBatchFetchToolParameterProperties,
  executeBatchFetchToolCall,
  executeFetchToolCall,
  type FetchResult,
  isError,
  resolveFetchToolDefaults,
} from "smart-fetch-core";
import type { PluginConfig, ToolRegistrationApi } from "./types";

export const resolvePluginDefaults = (pluginConfig: PluginConfig = {}) =>
  resolveFetchToolDefaults({
    tempDir: join(tmpdir(), "smart-fetch-openclaw"),
    ...pluginConfig,
  });

function renderToolResponse(result: FetchResult) {
  return {
    content: [
      {
        type: "text" as const,
        text: buildFetchResponseText(result, { verbose: true }),
      },
    ],
  };
}

const plugin = {
  id: "smart-fetch",
  name: "Smart Fetch",
  description:
    "Clean web content extraction with TLS fingerprinting. Uses wreq-js (Rust native bindings) for browser-grade TLS and Defuddle for extraction.",

  register(api: ToolRegistrationApi) {
    const defaults = resolvePluginDefaults(api.pluginConfig);

    api.registerTool({
      name: "smart_fetch",
      description: [
        "Fetch a URL with browser-grade TLS fingerprinting and extract clean, readable content.",
        "Uses Rust native bindings to impersonate real browsers at the TLS/HTTP2 level (JA3/JA4 match).",
        "Returns markdown with rich metadata (author, publish date, schema.org data).",
        "Better noise removal and anti-bot bypass than web_fetch.",
        "Does NOT execute JavaScript — use the browser tool for JS-heavy SPAs.",
      ].join(" "),
      parameters: Type.Object(createBaseFetchToolParameterProperties(defaults)),

      async execute(_toolCallId: string, params: Record<string, unknown>) {
        try {
          const result = await executeFetchToolCall(params, defaults);

          if (isError(result)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: buildFetchErrorResponseText(result),
                },
              ],
              isError: true,
            };
          }

          return renderToolResponse(result);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Unexpected smart_fetch failure.\n\n${message}`,
              },
            ],
            isError: true,
          };
        }
      },
    });

    api.registerTool({
      name: "batch_smart_fetch",
      description: [
        "Fetch multiple URLs with browser-grade TLS fingerprinting and clean readable extraction.",
        "Each request item accepts the same parameters as smart_fetch and runs with bounded concurrency.",
        "Returns clearly labeled per-item results with full content for successes and bot-friendly per-item errors for failures.",
        "Does NOT execute JavaScript — use the browser tool for JS-heavy SPAs.",
      ].join(" "),
      parameters: Type.Object(
        createBatchFetchToolParameterProperties(defaults),
      ),

      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const result = await executeBatchFetchToolCall(params, defaults, {
          batchConcurrency: defaults.batchConcurrency,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: buildBatchFetchResponseText(result, { verbose: true }),
            },
          ],
        };
      },
    });
  },
};

export default plugin;
