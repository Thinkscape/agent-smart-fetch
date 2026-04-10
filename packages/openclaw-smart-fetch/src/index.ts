import { Type } from "@sinclair/typebox";
import {
  buildFetchResponseText,
  createBaseFetchToolParameterProperties,
  executeFetchToolCall,
  type FetchResult,
  isError,
  resolveFetchToolDefaults,
} from "smart-fetch-core";
import type { PluginConfig, ToolRegistrationApi } from "./types";

export const resolvePluginDefaults = (pluginConfig: PluginConfig = {}) =>
  resolveFetchToolDefaults(pluginConfig);

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
      name: "defuddle_fetch",
      description: [
        "Fetch a URL with browser-grade TLS fingerprinting and extract clean, readable content.",
        "Uses Rust native bindings to impersonate real browsers at the TLS/HTTP2 level (JA3/JA4 match).",
        "Returns markdown with rich metadata (author, publish date, schema.org data).",
        "Better noise removal and anti-bot bypass than web_fetch.",
        "Does NOT execute JavaScript — use the browser tool for JS-heavy SPAs.",
      ].join(" "),
      parameters: Type.Object(createBaseFetchToolParameterProperties(defaults)),

      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const result = await executeFetchToolCall(params, defaults);

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
