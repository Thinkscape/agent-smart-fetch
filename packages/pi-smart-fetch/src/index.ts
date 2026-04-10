import { type ExtensionAPI, getAgentDir } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  buildFetchResponseText,
  createBaseFetchToolParameterProperties,
  executeFetchToolCall,
  isError,
  resolveFetchToolDefaults,
} from "smart-fetch-core";
import { loadPiSmartFetchSettings } from "./settings";

const toolDescription = [
  "Fetch a URL with browser-grade TLS fingerprinting and extract clean, readable content.",
  "Uses wreq-js for browser-like TLS/HTTP2 impersonation and Defuddle for article extraction.",
  "Supports the same fetch parameters as the OpenClaw tool, plus an optional verbose flag.",
  "Does NOT execute JavaScript — use a browser automation tool for JS-heavy pages.",
].join(" ");

export default function piSmartFetchExtension(pi: ExtensionAPI) {
  const defaults = resolveFetchToolDefaults();

  pi.registerTool({
    name: "web_fetch",
    label: "web_fetch",
    description: toolDescription,
    promptSnippet:
      "web_fetch(url, browser?, os?, headers?, maxChars?, format?, removeImages?, includeReplies?, proxy?, verbose?): fetch browser-fingerprinted readable web content",
    parameters: Type.Object({
      ...createBaseFetchToolParameterProperties(defaults),
      verbose: Type.Optional(
        Type.Boolean({
          description:
            "Include the full metadata header (site, language, word count, browser fingerprint info). Default: false, or smartFetchVerboseByDefault from pi settings.",
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const settings = await loadPiSmartFetchSettings(ctx.cwd, getAgentDir());
      const runtimeDefaults = resolveFetchToolDefaults(settings);
      const verbose =
        (params.verbose as boolean | undefined) ?? settings.verboseByDefault;
      const result = await executeFetchToolCall(params, runtimeDefaults);

      if (isError(result)) {
        return {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          details: { error: true, verbose },
        };
      }

      return {
        content: [
          { type: "text", text: buildFetchResponseText(result, { verbose }) },
        ],
        details: { verbose, maxChars: runtimeDefaults.maxChars },
      };
    },
  });
}
