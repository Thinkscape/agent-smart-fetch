import type {
  BatchFetchItemResult,
  BatchFetchResult,
  FetchError,
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
    const errorHeader = buildHeader([
      ["URL", item.request.url],
      ["Status", "error"],
      ["Error", item.error ?? "Unknown error"],
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
