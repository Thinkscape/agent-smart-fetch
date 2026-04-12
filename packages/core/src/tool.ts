import { type TSchema, Type } from "@sinclair/typebox";
import {
  DEFAULT_BATCH_CONCURRENCY,
  DEFAULT_BROWSER,
  DEFAULT_INCLUDE_REPLIES,
  DEFAULT_MAX_CHARS,
  DEFAULT_OS,
  DEFAULT_TIMEOUT_MS,
} from "./constants";
import { defuddleFetch, isError } from "./extract";
import {
  buildFetchErrorResponseText,
  buildUserFacingFetchErrorSummary,
} from "./format";
import type {
  BatchFetchItemProgress,
  BatchFetchItemResult,
  BatchFetchItemStatus,
  BatchFetchProgressSnapshot,
  BatchFetchResult,
  FetchError,
  FetchExecutionHooks,
  FetchOptions,
  FetchResult,
  FetchToolConfig,
  FetchToolDefaults,
} from "./types";

function resolveBatchConcurrency(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_BATCH_CONCURRENCY;
  }

  return Math.max(1, Math.floor(value));
}

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
    batchConcurrency: resolveBatchConcurrency(config.batchConcurrency),
    tempDir: config.tempDir,
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
    timeoutMs: Type.Optional(
      Type.Number({
        description: `Request timeout in milliseconds. Default: ${defaults.timeoutMs}`,
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

export function createBatchFetchToolParameterProperties(
  defaults: FetchToolDefaults,
): Record<string, TSchema> {
  return {
    requests: Type.Array(
      Type.Object(createBaseFetchToolParameterProperties(defaults), {
        additionalProperties: false,
      }),
      {
        minItems: 1,
        description:
          "Array of fetch requests. Each item accepts the same parameters as the single-item fetch tool.",
      },
    ),
  };
}

function buildFetchOptionsFromParams(
  params: Record<string, unknown>,
  defaults: FetchToolDefaults,
): FetchOptions {
  return {
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
    timeoutMs: (params.timeoutMs as number) ?? defaults.timeoutMs,
    tempDir: defaults.tempDir,
  };
}

export async function executeFetchToolCall(
  params: Record<string, unknown>,
  defaults: FetchToolDefaults,
  hooks: FetchExecutionHooks = {},
): Promise<FetchResult | FetchError> {
  return defuddleFetch(buildFetchOptionsFromParams(params, defaults), hooks);
}

const PROGRESS_BY_STATUS: Record<BatchFetchItemStatus, number> = {
  queued: 0,
  connecting: 0,
  waiting: 0.11,
  loading: 0.51,
  processing: 0.96,
  done: 1,
  error: 1,
};

function createInitialProgressItems(
  requests: Record<string, unknown>[],
): BatchFetchItemProgress[] {
  return requests.map((request, index) => ({
    index,
    url:
      typeof request.url === "string" ? request.url : String(request.url ?? ""),
    status: "queued",
    progress: PROGRESS_BY_STATUS.queued,
    statusStartedAt: Date.now(),
  }));
}

function buildProgressSnapshot(
  items: BatchFetchItemProgress[],
  batchConcurrency: number,
): BatchFetchProgressSnapshot {
  let completed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const item of items) {
    if (item.status === "done" || item.status === "error") {
      completed += 1;
    }
    if (item.status === "done") {
      succeeded += 1;
    }
    if (item.status === "error") {
      failed += 1;
    }
  }

  return {
    items: items.map((item) => ({ ...item })),
    total: items.length,
    completed,
    succeeded,
    failed,
    batchConcurrency,
  };
}

export async function executeBatchFetchToolCall(
  params: Record<string, unknown>,
  defaults: FetchToolDefaults,
  options: {
    batchConcurrency?: number;
    onProgress?(snapshot: BatchFetchProgressSnapshot): void;
    executeItem?(
      params: Record<string, unknown>,
      defaults: FetchToolDefaults,
      hooks?: FetchExecutionHooks,
    ): Promise<FetchResult | FetchError>;
  } = {},
): Promise<BatchFetchResult> {
  const requests = (
    (params.requests as Record<string, unknown>[] | undefined) ?? []
  ).map((request) => request ?? {});
  const batchConcurrency = resolveBatchConcurrency(
    options.batchConcurrency ?? defaults.batchConcurrency,
  );
  const progressItems = createInitialProgressItems(requests);
  const results = new Array<BatchFetchItemResult>(requests.length);

  const emitProgress = () => {
    options.onProgress?.(
      buildProgressSnapshot(progressItems, batchConcurrency),
    );
  };

  const updateProgress = (
    index: number,
    status: BatchFetchItemStatus,
    error?: string,
    progress?: number,
  ) => {
    const previous = progressItems[index];
    progressItems[index] = {
      ...previous,
      status,
      progress:
        progress === undefined
          ? PROGRESS_BY_STATUS[status]
          : Math.max(0, Math.min(1, progress)),
      statusStartedAt:
        previous?.status === status ? previous.statusStartedAt : Date.now(),
      ...(error ? { error } : {}),
    };
    emitProgress();
  };

  emitProgress();

  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= requests.length) {
        return;
      }

      const request = requests[index] ?? {};
      const normalizedRequest = buildFetchOptionsFromParams(request, defaults);

      try {
        const executeItem = options.executeItem ?? executeFetchToolCall;
        const result = await executeItem(request, defaults, {
          onStatusChange(status) {
            if (status === "done") return;
            updateProgress(index, status);
          },
          onProgressChange(update) {
            if (update.status === "done") return;
            updateProgress(index, update.status, undefined, update.progress);
          },
        });

        if (isError(result)) {
          const errorText = buildFetchErrorResponseText(result);
          results[index] = {
            index,
            request: normalizedRequest,
            status: "error",
            progress: PROGRESS_BY_STATUS.error,
            error: errorText,
          };
          updateProgress(
            index,
            "error",
            buildUserFacingFetchErrorSummary(result),
          );
          continue;
        }

        results[index] = {
          index,
          request: normalizedRequest,
          status: "done",
          progress: PROGRESS_BY_STATUS.done,
          result,
        };
        updateProgress(index, "done");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results[index] = {
          index,
          request: normalizedRequest,
          status: "error",
          progress: PROGRESS_BY_STATUS.error,
          error: message,
        };
        updateProgress(index, "error", message);
      }
    }
  };

  const workerCount =
    requests.length === 0 ? 0 : Math.min(batchConcurrency, requests.length);
  await Promise.all(Array.from({ length: workerCount }, async () => worker()));

  const finalSnapshot = buildProgressSnapshot(progressItems, batchConcurrency);

  return {
    items: results,
    total: finalSnapshot.total,
    succeeded: finalSnapshot.succeeded,
    failed: finalSnapshot.failed,
    batchConcurrency,
  };
}
