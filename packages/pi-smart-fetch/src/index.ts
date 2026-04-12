import {
  type ExtensionAPI,
  getAgentDir,
  getMarkdownTheme,
  keyText,
} from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import {
  type BatchFetchItemProgress,
  type BatchFetchProgressSnapshot,
  type BatchFetchResult,
  buildBatchFetchResponseText,
  buildFetchErrorResponseText,
  buildFetchResponseText,
  buildUserFacingFetchErrorSummary,
  createBaseFetchToolParameterProperties,
  createBatchFetchToolParameterProperties,
  executeBatchFetchToolCall,
  executeFetchToolCall,
  type FetchResult,
  isError,
  isFileFetchResult,
  type OutputFormat,
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

type WebFetchRenderDetails = {
  error?: boolean;
  errorText?: string;
  userErrorSummary?: string;
  verbose?: boolean;
  format?: OutputFormat;
  maxChars?: number;
  fetchResult?: FetchResult;
  started?: boolean;
  status?:
    | "connecting"
    | "waiting"
    | "loading"
    | "processing"
    | "done"
    | "error";
  progress?: number;
  phase?: string;
  url?: string;
  spinnerTick?: number;
};

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

function getOptimisticProgress(
  item: BatchFetchItemProgress,
  now: number,
): number {
  const base = item.progress;
  const startedAt = item.statusStartedAt ?? now;
  const elapsedWholeSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));

  switch (item.status) {
    case "connecting":
      return Math.min(0.1, Math.max(base, elapsedWholeSeconds * 0.01));
    case "waiting":
      return Math.min(0.5, Math.max(base, 0.11 + elapsedWholeSeconds * 0.01));
    case "processing":
      return Math.min(0.99, Math.max(base, 0.96 + elapsedWholeSeconds * 0.01));
    default:
      return base;
  }
}

function renderProgressBar(
  item: BatchFetchItemProgress,
  width: number,
  theme: {
    fg(color: string, value: string): string;
    bg(color: string, value: string): string;
  },
  now: number,
): string {
  const innerWidth = Math.max(10, width - 2);
  const progress = getOptimisticProgress(item, now);
  const filled = Math.max(
    0,
    Math.min(innerWidth, Math.round(progress * innerWidth)),
  );
  const barBgColor =
    item.status === "error"
      ? "toolErrorBg"
      : item.status === "done"
        ? "toolSuccessBg"
        : item.status === "queued"
          ? "toolPendingBg"
          : "selectedBg";

  const centeredLabel = (() => {
    const raw = item.status;
    if (raw.length >= innerWidth) {
      return raw.slice(0, innerWidth);
    }
    const totalPadding = innerWidth - raw.length;
    const leftPadding = Math.floor(totalPadding / 2);
    const rightPadding = totalPadding - leftPadding;
    return `${" ".repeat(leftPadding)}${raw}${" ".repeat(rightPadding)}`;
  })();
  const filledLabel = centeredLabel.slice(0, filled);
  const emptyLabel = centeredLabel.slice(filled);

  return [
    theme.fg("muted", "["),
    theme.bg(barBgColor, theme.fg("text", filledLabel)),
    theme.bg("toolPendingBg", theme.fg("muted", emptyLabel)),
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
    bg(color: string, value: string): string;
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

  const availableRowWidth = Math.max(24, width);
  const progressWidth = Math.max(
    12,
    Math.min(18, Math.floor(availableRowWidth * 0.2)),
  );
  const glyphWidth = 2;
  const urlWidth = Math.max(
    12,
    availableRowWidth - glyphWidth - progressWidth - 2,
  );

  const now = Date.now();

  const rows = snapshot.items.map((item, index) => {
    const glyph = renderStatusGlyph(item, spinnerTick + index, theme);
    const url = theme.fg("accent", truncateMiddle(item.url, urlWidth));
    const bar = renderProgressBar(item, progressWidth, theme, now);

    const baseRow = `${glyph} ${url} ${bar}`;
    if (!expanded || !item.error) {
      return baseRow;
    }

    return `${baseRow}\n  ${theme.fg("error", `error: ${item.error}`)}`;
  });

  return [summary, ...rows].join("\n");
}

function buildWebFetchMetadataLines(
  details: WebFetchRenderDetails,
  theme: {
    fg(color: string, value: string): string;
  },
): string[] {
  const fetchResult = details.fetchResult;
  if (!fetchResult) {
    return [];
  }

  const metadata: Array<[label: string, value: string | number | undefined]> =
    details.verbose
      ? [
          ["URL", fetchResult.finalUrl],
          ["Title", fetchResult.title],
          ["Author", fetchResult.author],
          ["Published", fetchResult.published],
          ["Site", fetchResult.site],
          ["Language", fetchResult.language],
          ["Words", fetchResult.wordCount],
          ["Browser", `${fetchResult.browser}/${fetchResult.os}`],
        ]
      : [
          ["URL", fetchResult.finalUrl],
          ["Title", fetchResult.title],
          ["Author", fetchResult.author],
          ["Published", fetchResult.published],
        ];

  return metadata
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([label, value]) => theme.fg("accent", `${label}: ${value}`));
}

function shouldRenderHighlightedContent(format?: OutputFormat) {
  return format === "markdown" || format === "json" || format === "html";
}

function buildHighlightedMarkdownContent(
  content: string,
  format: OutputFormat,
): string {
  if (format === "json") {
    return `\`\`\`json\n${content}\n\`\`\``;
  }

  if (format === "html") {
    return `\`\`\`html\n${content}\n\`\`\``;
  }

  return content;
}

function buildWebFetchCollapsedPreview(details: WebFetchRenderDetails): {
  previewContent: string;
  remainingLines: number;
} {
  const contentLines = (details.fetchResult?.content ?? "")
    .split("\n")
    .filter(
      (line, index, lines) =>
        line.length > 0 || index === 0 || index < lines.length - 1,
    );
  const maxPreviewLines = 7;
  const previewLines = contentLines.slice(0, maxPreviewLines);

  return {
    previewContent: previewLines.join("\n"),
    remainingLines: Math.max(0, contentLines.length - previewLines.length),
  };
}

function createWebFetchResultComponent(
  details: WebFetchRenderDetails,
  expanded: boolean,
  theme: {
    fg(color: string, value: string): string;
  },
) {
  const fetchResult = details.fetchResult;
  if (!fetchResult) {
    return new Text(theme.fg("muted", "No fetch result available."), 0, 0);
  }

  const metadataLines = buildWebFetchMetadataLines(details, theme);
  const container = new Container();

  if (metadataLines.length > 0) {
    container.addChild(new Text(metadataLines.join("\n"), 0, 0));
  }

  if (isFileFetchResult(fetchResult)) {
    const fileLines = [
      theme.fg("muted", `File size: ${fetchResult.fileSize}`),
      ...(fetchResult.mimeType
        ? [theme.fg("muted", `Mime type: ${fetchResult.mimeType}`)]
        : []),
      theme.fg("muted", `File path: ${fetchResult.filePath}`),
    ];

    if (metadataLines.length > 0 && fileLines.length > 0) {
      container.addChild(new Spacer(1));
    }
    container.addChild(new Text(fileLines.join("\n"), 0, 0));
    return container;
  }

  const { previewContent, remainingLines } =
    buildWebFetchCollapsedPreview(details);
  const content = expanded ? fetchResult.content : previewContent;
  const format = details.format ?? "markdown";

  if (metadataLines.length > 0 && content) {
    container.addChild(new Spacer(1));
  }

  if (content) {
    if (shouldRenderHighlightedContent(format)) {
      container.addChild(
        new Markdown(
          buildHighlightedMarkdownContent(content, format),
          0,
          0,
          getMarkdownTheme(),
        ),
      );
    } else {
      container.addChild(new Text(content, 0, 0));
    }
  }

  if (!expanded && remainingLines > 0) {
    const expandKey = keyText("app.tools.expand") || "Ctrl+O";
    if (content) {
      container.addChild(new Spacer(1));
    }
    container.addChild(
      new Text(
        theme.fg("muted", `... (${remainingLines} more lines, `) +
          theme.fg("dim", expandKey) +
          theme.fg("muted", " to expand)"),
        0,
        0,
      ),
    );
  }

  return container;
}

function renderSingleFetchProgressText(
  details: WebFetchRenderDetails,
  width: number,
  theme: {
    fg(color: string, value: string): string;
    bg(color: string, value: string): string;
  },
) {
  const status = details.status ?? "connecting";
  const url =
    details.url ??
    details.fetchResult?.finalUrl ??
    details.fetchResult?.url ??
    "";
  const item: BatchFetchItemProgress = {
    index: 0,
    url,
    status,
    progress: details.progress ?? 0,
    statusStartedAt: Date.now(),
  };

  const availableRowWidth = Math.max(24, width);
  const progressWidth = Math.max(
    12,
    Math.min(18, Math.floor(availableRowWidth * 0.2)),
  );
  const glyphWidth = 2;
  const urlWidth = Math.max(
    12,
    availableRowWidth - glyphWidth - progressWidth - 2,
  );

  const glyph = renderStatusGlyph(item, details.spinnerTick ?? 0, theme);
  const renderedUrl = theme.fg("accent", truncateMiddle(url, urlWidth));
  const bar = renderProgressBar(item, progressWidth, theme, Date.now());

  return `${glyph} ${renderedUrl} ${bar}`;
}

function createResponsiveSingleFetchProgressComponent(
  details: WebFetchRenderDetails,
  theme: {
    fg(color: string, value: string): string;
    bg(color: string, value: string): string;
  },
) {
  const text = new Text("", 0, 0);

  return {
    render(width: number) {
      text.setText(renderSingleFetchProgressText(details, width, theme));
      return text.render(width);
    },
    invalidate() {
      text.invalidate();
    },
  };
}

function createResponsiveBatchComponent(
  details: BatchRenderDetails,
  expanded: boolean,
  theme: {
    bold(value: string): string;
    fg(color: string, value: string): string;
    bg(color: string, value: string): string;
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
      "web_fetch(url, browser?, os?, headers?, maxChars?, timeoutMs?, format?, removeImages?, includeReplies?, proxy?, verbose?): fetch browser-fingerprinted readable web content",
    parameters: Type.Object({
      ...createBaseFetchToolParameterProperties(defaults),
      verbose: Type.Optional(
        Type.Boolean({
          description:
            "Include the full metadata header (site, language, word count, browser fingerprint info). Default: false, or smartFetchVerboseByDefault from pi settings.",
        }),
      ),
    }),

    async execute(
      _toolCallId,
      params: Record<string, unknown>,
      _signal,
      onUpdate,
      ctx,
    ) {
      const settings = await loadPiSmartFetchSettings(ctx.cwd, getAgentDir());
      const runtimeDefaults = resolveFetchToolDefaults(settings);
      const verbose =
        (params.verbose as boolean | undefined) ?? settings.verboseByDefault;

      let spinnerTick = 0;
      let spinnerTimer: ReturnType<typeof setInterval> | null = null;
      let latestDetails: WebFetchRenderDetails = {
        verbose,
        format: (params.format as OutputFormat | undefined) ?? "markdown",
        started: true,
        status: "connecting",
        progress: 0,
        phase: "fetch_start",
        url: typeof params.url === "string" ? params.url : undefined,
        spinnerTick,
      };

      const emitProgress = (details: WebFetchRenderDetails) => {
        latestDetails = details;
        onUpdate?.({
          content: [
            {
              type: "text",
              text: `Fetching ${details.url ?? params.url ?? "URL"}...`,
            },
          ],
          details,
        });
      };

      try {
        spinnerTimer = setInterval(() => {
          if (latestDetails.status === "done") {
            return;
          }
          spinnerTick += 1;
          emitProgress({
            ...latestDetails,
            spinnerTick,
          });
        }, SPINNER_INTERVAL_MS);

        const result = await executeFetchToolCall(params, runtimeDefaults, {
          onStatusChange(status) {
            emitProgress({
              ...latestDetails,
              status,
              progress:
                latestDetails.progress ??
                (status === "processing"
                  ? 0.96
                  : status === "loading"
                    ? 0.51
                    : status === "waiting"
                      ? 0.11
                      : 0),
              spinnerTick,
            });
          },
          onProgressChange(update) {
            emitProgress({
              ...latestDetails,
              status: update.status,
              progress: update.progress,
              phase: update.phase,
              spinnerTick,
            });
          },
        });

        if (isError(result)) {
          const errorText = buildFetchErrorResponseText(result);
          return {
            content: [{ type: "text", text: errorText }],
            details: {
              error: true,
              errorText,
              userErrorSummary: buildUserFacingFetchErrorSummary(result),
              verbose,
              status: latestDetails.status,
              phase: latestDetails.phase,
              url: latestDetails.url,
              spinnerTick,
            } satisfies WebFetchRenderDetails,
          };
        }

        return {
          content: [
            { type: "text", text: buildFetchResponseText(result, { verbose }) },
          ],
          details: {
            verbose,
            format: latestDetails.format,
            maxChars: runtimeDefaults.maxChars,
            fetchResult: result,
            started: true,
            status: "done",
            progress: 1,
            phase: "done",
            url: result.finalUrl || result.url,
            spinnerTick,
          } satisfies WebFetchRenderDetails,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const errorText = `Error: Unexpected web_fetch failure for ${typeof params.url === "string" ? params.url : "URL"}.\n\n${message}`;
        return {
          content: [{ type: "text", text: errorText }],
          details: {
            error: true,
            errorText,
            userErrorSummary:
              "The request failed before a usable response was returned.",
            verbose,
            status: latestDetails.status,
            phase: latestDetails.phase,
            url: latestDetails.url,
            spinnerTick,
          } satisfies WebFetchRenderDetails,
        };
      } finally {
        if (spinnerTimer) {
          clearInterval(spinnerTimer);
        }
      }
    },

    renderCall(args: Record<string, unknown>, theme) {
      const url = typeof args.url === "string" ? args.url : "...";
      return new Text(
        `${theme.fg("toolTitle", "web_fetch")} ${theme.fg("accent", url)}`,
        0,
        0,
      );
    },

    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        const details =
          (result.details as WebFetchRenderDetails | undefined) ?? {};
        return createResponsiveSingleFetchProgressComponent(details, theme);
      }

      const details =
        (result.details as WebFetchRenderDetails | undefined) ?? {};
      const textContent = result.content.find((item) => item.type === "text");
      const outputText = textContent?.type === "text" ? textContent.text : "";

      if (details.error) {
        return new Text(
          theme.fg(
            "error",
            details.userErrorSummary ||
              outputText ||
              details.errorText ||
              "Error",
          ),
          0,
          0,
        );
      }

      return createWebFetchResultComponent(details, expanded, theme);
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
