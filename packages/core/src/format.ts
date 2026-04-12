import type {
  BatchFetchItemResult,
  BatchFetchResult,
  FetchError,
  FetchErrorPhase,
  FetchResult,
  OutputFormat,
} from "./types";

export function isFileFetchResult(
  result: FetchResult,
): result is Extract<FetchResult, { kind: "file" }> {
  return result.kind === "file";
}

function buildHeader(
  parts: Array<[label: string, value: string | number | undefined]>,
) {
  return parts
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([label, value]) => `> ${label}: ${value}`)
    .join("\n");
}

function formatByteCount(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const decimals = unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatDurationMs(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${durationMs}ms (${seconds.toFixed(seconds >= 10 ? 0 : 1)}s)`;
  }

  const minutes = seconds / 60;
  return `${durationMs}ms (${minutes.toFixed(minutes >= 10 ? 0 : 1)}m)`;
}

function describeErrorPhase(phase: FetchErrorPhase | undefined): string {
  switch (phase) {
    case "validation":
      return "validating the request";
    case "connecting":
      return "connecting";
    case "waiting":
      return "waiting for the server response";
    case "loading":
      return "downloading the response body";
    case "processing":
      return "processing the response";
    default:
      return "unknown";
  }
}

function roundSuggestedTimeoutMs(value: number): number {
  if (value <= 10_000) return Math.ceil(value / 1_000) * 1_000;
  if (value <= 60_000) return Math.ceil(value / 5_000) * 5_000;
  if (value <= 300_000) return Math.ceil(value / 10_000) * 10_000;
  return Math.ceil(value / 30_000) * 30_000;
}

function suggestRetryTimeoutMs(error: FetchError): number | undefined {
  if (!error.timeoutMs || error.timeoutMs <= 0) {
    return undefined;
  }

  if (
    error.phase === "loading" &&
    error.contentLength &&
    error.downloadedBytes &&
    error.downloadedBytes > 0
  ) {
    const projectedMs =
      (error.timeoutMs * error.contentLength) / error.downloadedBytes;
    return roundSuggestedTimeoutMs(projectedMs * 1.5);
  }

  if (error.phase === "processing") {
    return roundSuggestedTimeoutMs(error.timeoutMs * 2);
  }

  if (error.phase === "connecting" || error.phase === "waiting") {
    return roundSuggestedTimeoutMs(Math.max(error.timeoutMs * 2, 30_000));
  }

  return roundSuggestedTimeoutMs(error.timeoutMs * 2);
}

export function buildUserFacingFetchErrorSummary(error: FetchError): string {
  if (error.code === "http_error" && error.statusCode) {
    return `Server responded with ${error.statusCode}${error.statusText ? ` ${error.statusText}` : ""}`;
  }

  switch (error.code) {
    case "invalid_url":
      return "That URL is invalid.";
    case "unsupported_protocol":
      return "Only http and https URLs are supported.";
    case "timeout":
      switch (error.phase) {
        case "connecting":
          return "Timed out while connecting to the server.";
        case "waiting":
          return "The server took too long to start responding.";
        case "loading":
          return error.mimeType && !error.mimeType.startsWith("text/")
            ? "Timed out while downloading the file."
            : "Timed out while downloading the response.";
        case "processing":
          return "Timed out while processing the response.";
        default:
          return "The request timed out.";
      }
    case "unexpected_response":
      return "The response format was unexpected.";
    case "download_error":
      return "The file could not be saved locally.";
    case "no_content":
      return "No readable content could be extracted from the page.";
    case "processing_error":
      return "The response could not be processed.";
    case "network_error":
      return "The request failed before a usable response was returned.";
    default:
      return error.error;
  }
}

export function buildFetchErrorResponseText(error: FetchError): string {
  const lines = [`Error: ${error.error}`];

  const metadata = buildHeader([
    ["URL", error.url],
    ["Final URL", error.finalUrl],
    ["Phase", error.phase ? describeErrorPhase(error.phase) : undefined],
    [
      "Timeout",
      error.timeoutMs ? formatDurationMs(error.timeoutMs) : undefined,
    ],
    [
      "HTTP status",
      error.statusCode
        ? `${error.statusCode}${error.statusText ? ` ${error.statusText}` : ""}`
        : undefined,
    ],
    ["Mime type", error.mimeType],
    [
      "Content-Length",
      error.contentLength !== undefined
        ? `${error.contentLength} bytes (${formatByteCount(error.contentLength)})`
        : undefined,
    ],
    [
      "Downloaded before failure",
      error.downloadedBytes !== undefined
        ? `${error.downloadedBytes} bytes (${formatByteCount(error.downloadedBytes)})`
        : undefined,
    ],
    [
      "Suggested timeoutMs",
      error.code === "timeout" ? suggestRetryTimeoutMs(error) : undefined,
    ],
  ]);

  if (metadata) {
    lines.push("", metadata);
  }

  if (error.code === "timeout") {
    lines.push(
      "",
      "The timeoutMs parameter is configurable. Retry this call with a higher timeoutMs value.",
    );
  } else if (error.code === "http_error") {
    if (error.statusCode === 429) {
      lines.push(
        "",
        "The server rate-limited this request. Retrying later or using a different proxy may help.",
      );
    } else if (error.statusCode === 401 || error.statusCode === 403) {
      lines.push(
        "",
        "The server rejected this request. Authentication, a different browser profile, or a different proxy may be required.",
      );
    } else if ((error.statusCode ?? 0) >= 500) {
      lines.push(
        "",
        "The server failed while processing the request. Retrying later may help.",
      );
    }
  } else if (error.code === "download_error") {
    lines.push(
      "",
      "The download failed before completion. Retrying may help, especially if the connection was interrupted.",
    );
  } else if (error.retryable) {
    lines.push("", "Retrying this request may help.");
  }

  return lines.join("\n");
}

export function markdownToText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "• ")
    .replace(/`([^`]+)`/g, "$1");
}

export function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n\n[... truncated]`;
}

export function buildCompactMetadataHeader(result: FetchResult): string {
  if (isFileFetchResult(result)) {
    return buildHeader([
      ["URL", result.finalUrl],
      ["File size", result.fileSize],
      ["Mime type", result.mimeType],
      ["File path", result.filePath],
    ]);
  }

  return buildHeader([
    ["URL", result.finalUrl],
    ["Title", result.title],
    ["Author", result.author],
    ["Published", result.published],
  ]);
}

export function buildMetadataHeader(result: FetchResult): string {
  if (isFileFetchResult(result)) {
    return buildHeader([
      ["URL", result.finalUrl],
      ["File size", result.fileSize],
      ["Mime type", result.mimeType],
      ["File path", result.filePath],
      ["Browser", `${result.browser}/${result.os}`],
    ]);
  }

  return buildHeader([
    ["URL", result.finalUrl],
    ["Title", result.title],
    ["Author", result.author],
    ["Published", result.published],
    ["Site", result.site],
    ["Language", result.language],
    ["Words", result.wordCount],
    ["Browser", `${result.browser}/${result.os}`],
  ]);
}

export function buildFetchResponseText(
  result: FetchResult,
  options: { verbose?: boolean } = {},
): string {
  const header = options.verbose
    ? buildMetadataHeader(result)
    : buildCompactMetadataHeader(result);

  if (isFileFetchResult(result)) {
    return header;
  }

  return header ? `${header}\n\n${result.content}` : result.content;
}

function buildBatchItemHeading(
  item: BatchFetchItemResult,
  total: number,
): string {
  const ordinal = item.index + 1;
  const url = item.result?.finalUrl ?? item.request.url;
  return `## [${ordinal}/${total}] ${url}`;
}

function buildBatchItemText(
  item: BatchFetchItemResult,
  total: number,
  options: { verbose?: boolean } = {},
): string {
  const heading = buildBatchItemHeading(item, total);

  if (item.status === "error") {
    const errorText = item.error ?? "Unknown error";
    if (errorText.includes("\n")) {
      return `${heading}\n${errorText}`;
    }

    const errorHeader = buildHeader([
      ["URL", item.request.url],
      ["Status", "error"],
      ["Error", errorText.replace(/^Error:\s+/, "")],
    ]);
    return `${heading}\n${errorHeader}`;
  }

  return `${heading}\n${buildFetchResponseText(item.result as FetchResult, options)}`;
}

export function buildBatchFetchResponseText(
  result: BatchFetchResult,
  options: { verbose?: boolean } = {},
): string {
  const summary = buildHeader([
    ["Requests", result.total],
    ["Succeeded", result.succeeded],
    ["Failed", result.failed],
    ["Concurrency", result.batchConcurrency],
  ]);
  const items = result.items.map((item) =>
    buildBatchItemText(item, result.total, options),
  );

  return [summary, ...items].filter(Boolean).join("\n\n");
}

export function estimateWordCount(content: string): number {
  const words = content.trim().match(/\S+/g);
  return words?.length ?? 0;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function parseAndFormatJson(
  raw: string,
): { formatted: string } | FetchError {
  try {
    return {
      formatted: JSON.stringify(JSON.parse(raw), null, 2),
    };
  } catch {
    return { error: "Invalid JSON response" };
  }
}

export function renderJsonContent(
  formattedJson: string,
  format: OutputFormat,
): string {
  switch (format) {
    case "json":
    case "text":
      return formattedJson;
    case "html":
      return `<pre><code class="language-json">${escapeHtml(formattedJson)}</code></pre>`;
    default:
      return `\`\`\`json\n${formattedJson}\n\`\`\``;
  }
}

export function stripExtractorComments(
  content: string,
  format: OutputFormat,
): string {
  if (format === "html") {
    return content
      .replace(/\s*<hr>\s*<div class="[^"]* comments">[\s\S]*$/i, "")
      .trimEnd();
  }

  return content.replace(/\n---\n+## Comments\n[\s\S]*$/i, "").trimEnd();
}
