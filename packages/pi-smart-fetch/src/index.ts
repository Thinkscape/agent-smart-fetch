import { type ExtensionAPI, getAgentDir } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import {
  type BatchFetchItemProgress,
  type BatchFetchProgressSnapshot,
  type BatchFetchResult,
  buildBatchFetchResponseText,
  buildFetchResponseText,
  createBaseFetchToolParameterProperties,
  createBatchFetchToolParameterProperties,
  executeBatchFetchToolCall,
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

const batchToolDescription = [
  "Fetch multiple URLs with browser-grade TLS fingerprinting and readable extraction.",
  "Each request accepts the same parameters as web_fetch and fans out with bounded concurrency.",
  "Streams per-item progress in the pi TUI with truncated URLs, statuses, and small progress bars.",
  "Does NOT execute JavaScript — use a browser automation tool for JS-heavy pages.",
].join(" ");

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type BatchRenderDetails = {
  verbose?: boolean;
  batchProgress?: BatchFetchProgressSnapshot;
  batchResult?: BatchFetchResult;
  started?: boolean;
  spinnerTick?: number;
};

const SPINNER_INTERVAL_MS = 100;

function truncateMiddle(value: string, width: number): string {
  if (width <= 0) return "";
  if (value.length <= width) return value.padEnd(width, " ");
  if (width === 1) return "…";

  const left = Math.ceil((width - 1) / 2);
  const right = Math.floor((width - 1) / 2);
  return `${value.slice(0, left)}…${value.slice(value.length - right)}`;
}

function pad(value: string, width: number): string {
  return value.length >= width
    ? value.slice(0, width)
    : value.padEnd(width, " ");
}

function renderProgressBar(
  item: BatchFetchItemProgress,
  width: number,
  theme: {
    fg(color: string, value: string): string;
  },
): string {
  const innerWidth = Math.max(4, width - 2);
  const filled = Math.max(
    0,
    Math.min(innerWidth, Math.round(item.progress * innerWidth)),
  );
  const empty = Math.max(0, innerWidth - filled);
  const barColor =
    item.status === "error"
      ? "error"
      : item.status === "done"
        ? "success"
        : item.status === "queued"
          ? "muted"
          : "accent";

  return [
    theme.fg("muted", "["),
    theme.fg(barColor, "█".repeat(filled)),
    theme.fg("dim", "░".repeat(empty)),
    theme.fg("muted", "]"),
  ].join("");
}

function renderStatusGlyph(
  item: BatchFetchItemProgress,
  spinnerIndex: number,
  theme: {
    fg(color: string, value: string): string;
  },
): string {
  switch (item.status) {
    case "done":
      return theme.fg("success", "✓");
    case "error":
      return theme.fg("error", "✗");
    case "queued":
      return theme.fg(
        "muted",
        SPINNER_FRAMES[spinnerIndex % SPINNER_FRAMES.length] ?? "⠋",
      );
    default:
      return theme.fg(
        "accent",
        SPINNER_FRAMES[spinnerIndex % SPINNER_FRAMES.length] ?? "⠋",
      );
  }
}

function renderBatchProgressText(
  snapshot: BatchFetchProgressSnapshot,
  width: number,
  expanded: boolean,
  theme: {
    bold(value: string): string;
    fg(color: string, value: string): string;
  },
  spinnerTick = 0,
): string {
  const summary = [
    theme.fg("toolTitle", theme.bold("batch_web_fetch ")),
    theme.fg(
      "muted",
      `${snapshot.completed}/${snapshot.total} done · ok ${snapshot.succeeded} · err ${snapshot.failed} · concurrency ${snapshot.batchConcurrency}`,
    ),
  ].join("");

  const availableRowWidth = Math.max(24, Math.floor(width * 0.8));
  const statusWidth = 10;
  const progressWidth = Math.max(
    10,
    Math.min(18, Math.floor(availableRowWidth * 0.25)),
  );
  const glyphWidth = 2;
  const urlWidth = Math.max(
    12,
    availableRowWidth - glyphWidth - statusWidth - progressWidth - 3,
  );

  const rows = snapshot.items.map((item, index) => {
    const glyph = renderStatusGlyph(item, spinnerTick + index, theme);
    const url = theme.fg("accent", truncateMiddle(item.url, urlWidth));
    const statusColor =
      item.status === "error"
        ? "error"
        : item.status === "done"
          ? "success"
          : item.status === "queued"
            ? "muted"
            : "warning";
    const status = theme.fg(statusColor, pad(item.status, statusWidth));
    const bar = renderProgressBar(item, progressWidth, theme);

    const baseRow = `${glyph} ${url} ${status} ${bar}`;
    if (!expanded || !item.error) {
      return baseRow;
    }

    return `${baseRow}\n  ${theme.fg("error", `error: ${item.error}`)}`;
  });

  return [summary, ...rows].join("\n");
}

function createResponsiveBatchComponent(
  details: BatchRenderDetails,
  expanded: boolean,
  theme: {
    bold(value: string): string;
    fg(color: string, value: string): string;
  },
) {
  const text = new Text("", 0, 0);

  return {
    render(width: number) {
      const snapshot = details.batchProgress;
      if (!snapshot) {
        text.setText(theme.fg("muted", "No batch progress available."));
        return text.render(width);
      }

      const spinnerTick = details.spinnerTick ?? 0;
      text.setText(
        renderBatchProgressText(snapshot, width, expanded, theme, spinnerTick),
      );
      return text.render(width);
    },
    invalidate() {
      text.invalidate();
    },
  };
}

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

  pi.registerTool({
    name: "batch_web_fetch",
    label: "batch_web_fetch",
    description: batchToolDescription,
    promptSnippet:
      "batch_web_fetch(requests, verbose?): fetch multiple URLs concurrently with per-item progress in the pi TUI",
    parameters: Type.Object({
      ...createBatchFetchToolParameterProperties(defaults),
      verbose: Type.Optional(
        Type.Boolean({
          description:
            "Include the full metadata header for each successful result. Default: false, or smartFetchVerboseByDefault from pi settings.",
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const settings = await loadPiSmartFetchSettings(ctx.cwd, getAgentDir());
      const runtimeDefaults = resolveFetchToolDefaults(settings);
      const verbose =
        (params.verbose as boolean | undefined) ?? settings.verboseByDefault;

      let latestSnapshot: BatchFetchProgressSnapshot | undefined;
      let spinnerTick = 0;
      let spinnerTimer: ReturnType<typeof setInterval> | null = null;

      const emitProgress = (snapshot: BatchFetchProgressSnapshot) => {
        onUpdate?.({
          content: [
            {
              type: "text",
              text: `Started batch fetch for ${snapshot.total} URLs (${snapshot.completed}/${snapshot.total} complete).`,
            },
          ],
          details: {
            verbose,
            started: true,
            batchProgress: snapshot,
            spinnerTick,
          } satisfies BatchRenderDetails,
        });
      };

      try {
        spinnerTimer = setInterval(() => {
          if (
            !latestSnapshot ||
            latestSnapshot.completed >= latestSnapshot.total
          ) {
            return;
          }
          spinnerTick += 1;
          emitProgress(latestSnapshot);
        }, SPINNER_INTERVAL_MS);

        const batchResult = await executeBatchFetchToolCall(
          params,
          runtimeDefaults,
          {
            batchConcurrency: runtimeDefaults.batchConcurrency,
            onProgress(snapshot) {
              latestSnapshot = snapshot;
              emitProgress(snapshot);
            },
          },
        );

        const finalProgress: BatchFetchProgressSnapshot = {
          items: batchResult.items.map((item) => ({
            index: item.index,
            url: item.request.url,
            status: item.status,
            progress: item.progress,
            ...(item.error ? { error: item.error } : {}),
          })),
          total: batchResult.total,
          completed: batchResult.total,
          succeeded: batchResult.succeeded,
          failed: batchResult.failed,
          batchConcurrency: batchResult.batchConcurrency,
        };

        return {
          content: [
            {
              type: "text",
              text: buildBatchFetchResponseText(batchResult, { verbose }),
            },
          ],
          details: {
            verbose,
            started: true,
            batchProgress: finalProgress,
            batchResult,
            spinnerTick,
          } satisfies BatchRenderDetails,
        };
      } finally {
        if (spinnerTimer) {
          clearInterval(spinnerTimer);
        }
      }
    },

    renderCall(args, theme) {
      const batchArgs = args as { requests?: unknown[] };
      const requestCount = Array.isArray(batchArgs.requests)
        ? batchArgs.requests.length
        : 0;
      let text = theme.fg("toolTitle", theme.bold("batch_web_fetch "));
      text += theme.fg("muted", `${requestCount} urls`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      return createResponsiveBatchComponent(
        (result.details as BatchRenderDetails | undefined) ?? {},
        expanded,
        theme,
      );
    },
  });
}
