/**
 * Core extraction pipeline: fetch with TLS fingerprinting → parse → Defuddle extract.
 * Separated from the plugin entry so it can be tested independently.
 */

import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { pipeline } from "node:stream/promises";
import deburr from "lodash/deburr.js";
import { extension as mimeExtension } from "mime-types";
import {
  DEFAULT_ACCEPT_HEADER,
  DEFAULT_ACCEPT_LANGUAGE_HEADER,
  DEFAULT_BROWSER,
  DEFAULT_INCLUDE_REPLIES,
  DEFAULT_JSON_ACCEPT_HEADER,
  DEFAULT_MAX_CHARS,
  DEFAULT_OS,
  DEFAULT_RAW_ACCEPT_HEADER,
  DEFAULT_TIMEOUT_MS,
  MAX_CHARS_CEILING,
  MAX_DOWNLOAD_BYTES,
} from "./constants";
import {
  filterUnsafeHeaders,
  sanitizeUrlForLogging,
  validateUrlSafety,
} from "./url-safety";
import { runtimeDependencies } from "./dependencies";
import { parseLinkedomHTML } from "./dom";
import {
  estimateWordCount,
  markdownToText,
  parseAndFormatJson,
  renderJsonContent,
  stripExtractorComments,
  truncateContent,
} from "./format";
import { getLatestChromeProfile as getLatestChromeProfileFrom } from "./profiles";
import type {
  FetchDependencies,
  FetchError,
  FetchErrorPhase,
  FetchExecutionHooks,
  FetchOptions,
  FetchProgressUpdate,
  FetchResponseLike,
  FetchResult,
  OutputFormat,
} from "./types";

export {
  DEFAULT_BATCH_CONCURRENCY,
  DEFAULT_BROWSER,
  DEFAULT_INCLUDE_REPLIES,
  DEFAULT_MAX_CHARS,
  DEFAULT_OS,
  DEFAULT_TIMEOUT_MS,
} from "./constants";
export type {
  FetchError,
  FetchOptions,
  FetchResult,
  OutputFormat,
} from "./types";

const HTML_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "text/markdown",
];

const MAX_CLIENT_SIDE_REDIRECTS = 5;
const MAX_ALTERNATE_LINK_FALLBACKS = 3;
const MIN_EXTRACTED_WORDS_BEFORE_ALTERNATE_FALLBACK = 30;

function normalizeContentType(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isAttachmentDisposition(contentDisposition: string): boolean {
  return /^attachment(?:\s*;|\s*$)/i.test(contentDisposition.trim());
}

function isTextualContentType(contentType: string): boolean {
  const normalized = normalizeContentType(contentType);
  return (
    normalized.startsWith("text/") ||
    normalized === "application/json" ||
    normalized === "text/json" ||
    normalized.endsWith("+json") ||
    normalized === "application/xml" ||
    normalized === "text/xml" ||
    normalized.endsWith("+xml") ||
    normalized === "application/javascript" ||
    normalized === "application/x-javascript" ||
    normalized === "application/ecmascript" ||
    normalized === "image/svg+xml"
  );
}

function sanitizeBaseName(value: string): string {
  const sanitized = deburr(value)
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._ -]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .replace(/[. -]+$/g, "");

  return sanitized;
}

function sanitizeExtension(value: string): string {
  const raw = deburr(value)
    .replace(/^[.\s]+/, "")
    .replace(/[\\/]+/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "")
    .toLowerCase();

  return raw ? `.${raw}` : "";
}

function decodeContentDispositionFilename(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractContentDispositionFilename(contentDisposition: string): {
  baseName?: string;
  extension?: string;
} {
  const filenameStarMatch = contentDisposition.match(/filename\*=([^;]+)/i);
  const filenameMatch = contentDisposition.match(
    /filename=(?:"([^"]+)"|([^;]+))/i,
  );
  const rawFilename = filenameStarMatch?.[1]
    ? (() => {
        const value = filenameStarMatch[1].trim();
        const encoded = value.includes("''")
          ? value.split("''").slice(1).join("''")
          : value;
        return decodeContentDispositionFilename(encoded.replace(/^"|"$/g, ""));
      })()
    : (filenameMatch?.[1] ?? filenameMatch?.[2] ?? "").trim();

  if (!rawFilename) {
    return {};
  }

  const sanitizedFilename = rawFilename
    .replace(/^"|"$/g, "")
    .replace(/[\\/]+/g, "-");
  const parsed = parse(sanitizedFilename);
  return {
    baseName: sanitizeBaseName(parsed.name || sanitizedFilename),
    extension: sanitizeExtension(parsed.ext),
  };
}

function deriveUrlPathName(url: string): {
  baseName?: string;
  extension?: string;
} {
  try {
    const parsedUrl = new URL(url);
    const lastSegment = parsedUrl.pathname.split("/").filter(Boolean).at(-1);

    if (!lastSegment) {
      return {};
    }

    const decodedSegment = decodeContentDispositionFilename(lastSegment);
    const parsedSegment = parse(decodedSegment);
    return {
      baseName: sanitizeBaseName(parsedSegment.name || decodedSegment),
      extension: sanitizeExtension(parsedSegment.ext),
    };
  } catch {
    return {};
  }
}

function resolveExtensionFromMimeType(contentType: string): string {
  const extension = mimeExtension(normalizeContentType(contentType));
  return (
    sanitizeExtension(typeof extension === "string" ? extension : "") || ".dat"
  );
}

function resolveDownloadTarget(
  finalUrl: string,
  contentDisposition: string,
  contentType: string,
): { fileName: string; extension: string } {
  const fromDisposition = extractContentDispositionFilename(contentDisposition);
  const fromUrl = deriveUrlPathName(finalUrl);
  const baseName =
    fromDisposition.baseName ||
    fromUrl.baseName ||
    sanitizeBaseName(randomUUID());
  const extension =
    fromDisposition.extension || resolveExtensionFromMimeType(contentType);

  return {
    fileName: `${baseName}${extension || ".dat"}`,
    extension: extension || ".dat",
  };
}

async function cleanupPartialFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
}

async function streamResponseToFile(
  response: FetchResponseLike,
  filePath: string,
): Promise<number> {
  await mkdir(parse(filePath).dir, { recursive: true });
  let fileSize = 0;

  if (response.body) {
    const output = createWriteStream(filePath, { flags: "wx", mode: 0o600 });
    const reader = response.body.getReader();
    let opened = false;

    try {
      await new Promise<void>((resolve, reject) => {
        output.once("open", () => {
          opened = true;
          resolve();
        });
        output.once("error", reject);
      });

      const finished = new Promise<void>((resolve, reject) => {
        output.once("finish", () => resolve());
        output.once("error", reject);
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        if (value) {
          fileSize += value.byteLength;
          if (fileSize > MAX_DOWNLOAD_BYTES) {
            output.destroy();
            await reader.cancel("download size limit exceeded");
            reader.releaseLock();
            await cleanupPartialFile(filePath);
            throw new Error(
              `Download exceeded maximum size of ${MAX_DOWNLOAD_BYTES} bytes`,
            );
          }
          if (!output.write(Buffer.from(value))) {
            await once(output, "drain");
          }
        }
      }
      output.end();
      await finished;
      await chmod(filePath, 0o600);
      return fileSize;
    } catch (error) {
      output.destroy();
      try {
        await reader.cancel(
          error instanceof Error ? error.message : String(error),
        );
      } catch {
        // ignore cancellation failures during cleanup
      }
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        throw error;
      }
      if (opened) {
        await cleanupPartialFile(filePath);
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  if (response.readable) {
    const source = response.readable();
    let aborted = false;
    source.on("data", (chunk: string | ArrayBufferView) => {
      fileSize +=
        typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
      if (!aborted && fileSize > MAX_DOWNLOAD_BYTES) {
        aborted = true;
        source.destroy(new Error(`Download exceeded maximum size of ${MAX_DOWNLOAD_BYTES} bytes`));
      }
    });
    try {
      await pipeline(
        source,
        createWriteStream(filePath, { flags: "wx", mode: 0o600 }),
      );
      await chmod(filePath, 0o600);
      return fileSize;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        throw error;
      }
      await cleanupPartialFile(filePath);
      throw error;
    }
  }

  const body = response.arrayBuffer
    ? new Uint8Array(await response.arrayBuffer())
    : new TextEncoder().encode(await response.text());
  fileSize = body.byteLength;
  if (fileSize > MAX_DOWNLOAD_BYTES) {
    throw new Error(
      `Download exceeded maximum size of ${MAX_DOWNLOAD_BYTES} bytes`,
    );
  }
  try {
    await writeFile(filePath, body, { mode: 0o600, flag: "wx" });
    await chmod(filePath, 0o600);
    return fileSize;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      throw error;
    }
    await cleanupPartialFile(filePath);
    throw error;
  }
}

function isPlainTextContentType(contentType: string): boolean {
  const normalized = normalizeContentType(contentType);
  return normalized === "text/plain" || normalized === "text/markdown";
}

function renderPlainTextContent(body: string, format: OutputFormat): string {
  if (format === "html") {
    return `<pre>${body
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")}</pre>`;
  }

  return body;
}

function buildPlainTextResult(
  opts: FetchOptions,
  finalUrl: string,
  rawBody: string,
  format: OutputFormat,
  maxChars: number,
  browser: string,
  os: string,
): FetchResult {
  const normalizedBody = rawBody.replace(/\r\n/g, "\n").trim();
  return {
    kind: "content",
    url: opts.url,
    finalUrl,
    title: "",
    author: "",
    published: "",
    site: new URL(finalUrl).hostname,
    language: "",
    wordCount: estimateWordCount(normalizedBody),
    content: truncateContent(
      renderPlainTextContent(normalizedBody, format),
      maxChars,
    ),
    browser,
    os,
  };
}

/**
 * Detects X/Twitter "JavaScript is disabled" shell pages that indicate a tweet
 * no longer exists (deleted, protected, or suspended). When X returns these
 * pages instead of a proper 404, the oEmbed API also returns 404.
 */
function isTwitterJsDisabledPage(document: Document, url: string): boolean {
  if (!/^(https?:\/\/)?(www\.)?(x\.com|twitter\.com)\//i.test(url))
    return false;
  const text =
    document.body?.textContent ?? document.documentElement?.textContent ?? "";
  return (
    text.includes("JavaScript is disabled") &&
    text.includes("supported browser")
  );
}

function extractDomTextFallback(document: Document): string {
  const bodyText =
    document.body?.textContent ?? document.documentElement?.textContent ?? "";
  return bodyText
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_{}[\]()+#.!|>-])/g, "\\$1");
}

function normalizeInlineWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function renderInlineMarkdown(node: Node): string {
  if (node.nodeType === 3) {
    return normalizeInlineWhitespace(node.textContent ?? "");
  }

  if (node.nodeType !== 1) {
    return "";
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();

  if (["script", "style", "meta", "link"].includes(tag)) {
    return "";
  }

  if (tag === "br") {
    return "  \n";
  }

  if (tag === "code") {
    const content = normalizeInlineWhitespace(element.textContent ?? "");
    return content ? `\`${content}\`` : "";
  }

  if (tag === "img") {
    const alt = element.getAttribute("alt") ?? "";
    const src = element.getAttribute("src") ?? "";
    return src ? `![${escapeMarkdownText(alt)}](${src})` : "";
  }

  const childContent = Array.from(element.childNodes)
    .map(renderInlineMarkdown)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (tag === "a") {
    const href = element.getAttribute("href") ?? "";
    if (!href) return childContent;
    return `[${childContent || href}](${href})`;
  }

  if (["strong", "b"].includes(tag)) {
    return childContent ? `**${childContent}**` : "";
  }

  if (["em", "i"].includes(tag)) {
    return childContent ? `*${childContent}*` : "";
  }

  return childContent;
}

function renderBlockMarkdown(node: Node, depth = 0): string {
  if (node.nodeType === 3) {
    const text = normalizeInlineWhitespace(node.textContent ?? "");
    return text ? `${text}\n\n` : "";
  }

  if (node.nodeType !== 1) {
    return "";
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();

  if (["script", "style", "meta", "link"].includes(tag)) {
    return "";
  }

  if (/^h[1-6]$/.test(tag)) {
    const level = Number.parseInt(tag.slice(1), 10);
    const content = Array.from(element.childNodes)
      .map(renderInlineMarkdown)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return content ? `${"#".repeat(level)} ${content}\n\n` : "";
  }

  if (tag === "p") {
    const content = Array.from(element.childNodes)
      .map(renderInlineMarkdown)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return content ? `${content}\n\n` : "";
  }

  if (tag === "pre") {
    const content = (element.textContent ?? "").trim();
    return content ? `\`\`\`\n${content}\n\`\`\`\n\n` : "";
  }

  if (tag === "blockquote") {
    const content = Array.from(element.childNodes)
      .map((child) => renderBlockMarkdown(child, depth))
      .join("")
      .trim();
    if (!content) return "";
    return `${content
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n")}\n\n`;
  }

  if (tag === "ul" || tag === "ol") {
    const items = Array.from(element.children)
      .filter((child) => child.tagName.toLowerCase() === "li")
      .map((child, index) => {
        const prefix = tag === "ol" ? `${index + 1}. ` : "- ";
        const content = Array.from(child.childNodes)
          .map((grandchild) => {
            const childTag =
              grandchild.nodeType === 1
                ? (grandchild as Element).tagName.toLowerCase()
                : "";
            return childTag === "ul" || childTag === "ol"
              ? `\n${renderBlockMarkdown(grandchild, depth + 1)}`
              : renderInlineMarkdown(grandchild);
          })
          .join(" ")
          .replace(/\s+\n/g, "\n")
          .replace(/\n\s+/g, "\n")
          .replace(/\s+/g, " ")
          .trim();
        if (!content) return "";
        const indented = content
          .split("\n")
          .map((line, lineIndex) =>
            lineIndex === 0
              ? `${"  ".repeat(depth)}${prefix}${line}`
              : `${"  ".repeat(depth + 1)}${line}`,
          )
          .join("\n");
        return indented;
      })
      .filter(Boolean)
      .join("\n");
    return items ? `${items}\n\n` : "";
  }

  if (tag === "hr") {
    return "---\n\n";
  }

  const blockContent = Array.from(element.childNodes)
    .map((child) => renderBlockMarkdown(child, depth))
    .join("");

  if (blockContent.trim()) {
    return blockContent;
  }

  const inlineContent = Array.from(element.childNodes)
    .map(renderInlineMarkdown)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return inlineContent ? `${inlineContent}\n\n` : "";
}

function extractDomMarkdownFallback(document: Document): string {
  const root = document.body ?? document.documentElement;
  if (!root) return "";

  return Array.from(root.childNodes)
    .map((node) => renderBlockMarkdown(node))
    .join("")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type WreqLikeRequestEvent = {
  type?: string;
  contentLength?: number | null;
  downloadedBytes?: number;
  status?: number;
  url?: string;
  message?: string;
};

type FetchErrorContext = {
  url: string;
  finalUrl?: string;
  phase: "connecting" | "waiting" | "loading" | "processing" | "unknown";
  timeoutMs: number;
  statusCode?: number;
  statusText?: string;
  mimeType?: string;
  contentLength?: number;
  downloadedBytes?: number;
};

function emitProgress(
  hooks: FetchExecutionHooks,
  update: FetchProgressUpdate,
): void {
  hooks.onProgressChange?.(update);
}

function emitStatus(
  hooks: FetchExecutionHooks,
  status: Exclude<FetchProgressUpdate["status"], never>,
): void {
  hooks.onStatusChange?.(status);
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

function parseContentLengthHeader(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|timeout|deadline exceeded|abort(?:ed)?/i.test(message);
}

function isDnsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /dns error|failed to lookup address|nodename nor servname provided|name resolution failed/i.test(
    message,
  );
}

function isConnectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /client error \(connect\)|connection refused|tcp connect error|connection reset|network unreachable|no route to host/i.test(
    message,
  );
}

function isTlsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ssl.*error|tls.*error|bad certificate|certificate.*invalid|unknown.*issuer/i.test(
    message,
  );
}

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function buildTimeoutError(context: FetchErrorContext): FetchError {
  const targetUrl = context.finalUrl ?? context.url;
  const timeoutLabel = `${context.timeoutMs}ms`;

  if (context.phase === "connecting") {
    return {
      error: `Timeout of ${timeoutLabel} exceeded while connecting to ${targetUrl}.`,
      code: "timeout",
      phase: "connecting",
      retryable: true,
      timeoutMs: context.timeoutMs,
      url: context.url,
      finalUrl: context.finalUrl,
    };
  }

  if (context.phase === "waiting") {
    return {
      error: `Timeout of ${timeoutLabel} exceeded while waiting for ${targetUrl} to start responding.`,
      code: "timeout",
      phase: "waiting",
      retryable: true,
      timeoutMs: context.timeoutMs,
      url: context.url,
      finalUrl: context.finalUrl,
    };
  }

  if (context.phase === "loading") {
    const sizeHint = context.contentLength
      ? ` a ${formatByteCount(context.contentLength)} ${context.mimeType && !isTextualContentType(context.mimeType) ? "file" : "response"}`
      : " the response body";
    return {
      error: `Timeout of ${timeoutLabel} exceeded while downloading${sizeHint} from ${targetUrl}.`,
      code: "timeout",
      phase: "loading",
      retryable: true,
      timeoutMs: context.timeoutMs,
      url: context.url,
      finalUrl: context.finalUrl,
      statusCode: context.statusCode,
      statusText: context.statusText,
      mimeType: context.mimeType,
      contentLength: context.contentLength,
      downloadedBytes: context.downloadedBytes,
    };
  }

  if (context.phase === "processing") {
    return {
      error: `Timeout of ${timeoutLabel} exceeded while processing the response from ${targetUrl}.`,
      code: "timeout",
      phase: "processing",
      retryable: true,
      timeoutMs: context.timeoutMs,
      url: context.url,
      finalUrl: context.finalUrl,
      statusCode: context.statusCode,
      statusText: context.statusText,
      mimeType: context.mimeType,
      contentLength: context.contentLength,
      downloadedBytes: context.downloadedBytes,
    };
  }

  return {
    error: `Timeout of ${timeoutLabel} exceeded while fetching ${targetUrl}.`,
    code: "timeout",
    phase: context.phase,
    retryable: true,
    timeoutMs: context.timeoutMs,
    url: context.url,
    finalUrl: context.finalUrl,
    statusCode: context.statusCode,
    statusText: context.statusText,
    mimeType: context.mimeType,
    contentLength: context.contentLength,
    downloadedBytes: context.downloadedBytes,
  };
}

function buildThrownFetchError(
  error: unknown,
  context: FetchErrorContext,
): FetchError {
  if (isTimeoutError(error)) {
    return buildTimeoutError(context);
  }

  const hostname = extractHostname(context.url);

  if (isDnsError(error)) {
    return {
      error: `DNS error: failed to lookup address for ${hostname}. Check the URL and try again.`,
      code: "network_error",
      phase: "connecting",
      retryable: false,
      url: context.url,
      finalUrl: context.finalUrl,
    };
  }

  if (isConnectError(error)) {
    return {
      error: `Connection failed to ${hostname}. The server may be unreachable or blocking requests.`,
      code: "network_error",
      phase: "connecting",
      retryable: true,
      url: context.url,
      finalUrl: context.finalUrl,
    };
  }

  if (isTlsError(error)) {
    return {
      error: `TLS/SSL error connecting to ${hostname}. The server's certificate may be invalid.`,
      code: "network_error",
      phase: "connecting",
      retryable: false,
      url: context.url,
      finalUrl: context.finalUrl,
    };
  }

  // For remaining errors, determine the actual phase.
  // If it's a connect-level error but phase was misattributed, correct it.
  const isConnectLevel =
    isDnsError(error) || isConnectError(error) || isTlsError(error);
  const effectivePhase: FetchErrorPhase = isConnectLevel
    ? "connecting"
    : context.phase;

  const rawMessage = error instanceof Error ? error.message : String(error);
  // Strip potential credentials from error messages (proxy URLs, etc.)
  const message = rawMessage.replace(
    /:\/\/[^@\s]+@/g,
    "://***@",
  );
  const targetUrl = context.finalUrl ?? context.url;
  const phaseDescription =
    effectivePhase === "loading"
      ? "downloading the response"
      : effectivePhase === "waiting"
        ? "waiting for the server response"
        : effectivePhase === "connecting"
          ? "connecting"
          : "fetching";

  return {
    error:
      effectivePhase === "processing"
        ? `Failed while processing the response from ${targetUrl}: ${message}`
        : `Request failed while ${phaseDescription} for ${targetUrl}: ${message}`,
    code:
      effectivePhase === "processing"
        ? "processing_error"
        : effectivePhase === "loading" && context.mimeType
          ? "download_error"
          : "network_error",
    phase: effectivePhase,
    retryable: effectivePhase !== "processing",
    timeoutMs: context.timeoutMs,
    url: context.url,
    finalUrl: context.finalUrl,
    statusCode: context.statusCode,
    statusText: context.statusText,
    mimeType: context.mimeType,
    contentLength: context.contentLength,
    downloadedBytes: context.downloadedBytes,
  };
}

function mapRequestEventToProgress(
  event: WreqLikeRequestEvent,
): FetchProgressUpdate | null {
  switch (event.type) {
    case "request_start":
      return { status: "connecting", progress: 0, phase: event.type };
    case "request_sent":
      return { status: "waiting", progress: 0.11, phase: event.type };
    case "response_headers":
      return { status: "loading", progress: 0.51, phase: event.type };
    case "body_progress": {
      const contentLength = event.contentLength;
      const downloadedBytes = event.downloadedBytes ?? 0;
      const bodyFraction =
        contentLength && contentLength > 0
          ? Math.max(0, Math.min(1, downloadedBytes / contentLength))
          : Math.max(0, Math.min(1, downloadedBytes / 65536));
      return {
        status: "loading",
        progress:
          contentLength && contentLength > 0
            ? 0.51 + bodyFraction * 0.44
            : 0.51,
        phase: event.type,
      };
    }
    case "body_complete":
      return { status: "loading", progress: 0.95, phase: event.type };
    case "done":
      return { status: "done", progress: 1, phase: event.type };
    case "error":
      return { status: "error", progress: 1, phase: event.type };
    default:
      return null;
  }
}

function resolveAcceptHeader(format: OutputFormat): string {
  if (format === "json") return DEFAULT_JSON_ACCEPT_HEADER;
  if (format === "raw") return DEFAULT_RAW_ACCEPT_HEADER;
  return DEFAULT_ACCEPT_HEADER;
}

function isJsonContentType(contentType: string): boolean {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    normalized === "application/json" ||
    normalized === "text/json" ||
    normalized.endsWith("+json")
  );
}

function isLikelyJsonBody(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function isJsonResponse(contentType: string, body: string): boolean {
  return isJsonContentType(contentType) || isLikelyJsonBody(body);
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function extractQualifiedAlternateLinks(
  document: Document,
  baseUrl: string,
  format: OutputFormat,
): string[] {
  const acceptedTypes: Record<OutputFormat, string[]> = {
    markdown: ["text/markdown", "text/x-markdown"],
    text: ["text/plain", "text/markdown", "text/x-markdown"],
    html: ["text/html", "application/xhtml+xml"],
    json: ["application/json", "text/json"],
    raw: [],
  };
  const accepted = acceptedTypes[format];
  const head = document.head;
  if (!head) return [];

  const links = Array.from(head.querySelectorAll("link"));
  const candidates: string[] = [];
  for (const link of links) {
    const rel = (link.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
    if (!rel.includes("alternate")) continue;

    const type = normalizeContentType(link.getAttribute("type") ?? "");
    const isAccepted =
      accepted.some((value) => type === value) ||
      (format === "json" && type.endsWith("+json"));
    if (!isAccepted) continue;

    const href = link.getAttribute("href");
    if (!href) continue;

    try {
      const target = new URL(href, baseUrl).toString();
      if (target !== baseUrl && !candidates.includes(target)) {
        candidates.push(target);
      }
    } catch {
      // Ignore malformed alternate links.
    }
  }

  return candidates;
}

function extractClientSideRedirect(
  body: string,
  baseUrl: string,
): string | null {
  const snippet = body.slice(0, 4096);
  const metaRefreshMatch = snippet.match(
    /<meta\b[^>]*http-equiv=["']?refresh["']?[^>]*content=["']?([^"'>]*)["']?[^>]*>/i,
  );
  const refreshContent = metaRefreshMatch?.[1];

  if (!refreshContent) {
    return null;
  }

  const [delayPart = "", ...rest] =
    decodeHtmlAttribute(refreshContent).split(";");
  const delaySeconds = Number.parseFloat(delayPart.trim());
  const urlMatch = rest.join(";").match(/\burl\s*=\s*(.+)$/i);
  const rawTarget = urlMatch?.[1]?.trim().replace(/^['"]|['"]$/g, "");

  if (
    !rawTarget ||
    !Number.isFinite(delaySeconds) ||
    delaySeconds < 0 ||
    delaySeconds >= 30
  ) {
    return null;
  }

  try {
    const targetUrl = new URL(rawTarget, baseUrl).toString();
    return targetUrl === baseUrl ? null : targetUrl;
  } catch {
    return null;
  }
}

function buildJsonResult(
  opts: FetchOptions,
  finalUrl: string,
  rawBody: string,
  format: OutputFormat,
  maxChars: number,
  browser: string,
  os: string,
): FetchResult | FetchError {
  const parsedJson = parseAndFormatJson(rawBody);

  if ("error" in parsedJson) {
    return parsedJson;
  }

  const content = truncateContent(
    renderJsonContent(parsedJson.formatted, format),
    maxChars,
  );

  return {
    kind: "content",
    url: opts.url,
    finalUrl,
    title: "",
    author: "",
    published: "",
    site: new URL(finalUrl).hostname,
    language: "",
    wordCount: estimateWordCount(parsedJson.formatted),
    content,
    browser,
    os,
  };
}

async function buildFileResult(
  opts: FetchOptions,
  response: FetchResponseLike,
  finalUrl: string,
  contentType: string,
  contentDisposition: string,
  browser: string,
  os: string,
): Promise<FetchResult | FetchError> {
  const tempDir = opts.tempDir || join(tmpdir(), "smart-fetch");
  await mkdir(tempDir, { recursive: true });

  const { fileName, extension } = resolveDownloadTarget(
    finalUrl,
    contentDisposition,
    contentType,
  );
  let filePath = join(tempDir, fileName);
  let attempt = 1;

  while (attempt <= 100) {
    try {
      const fileSize = await streamResponseToFile(response, filePath);

      return {
        kind: "file",
        url: opts.url,
        finalUrl,
        title: "",
        author: "",
        published: "",
        site: new URL(finalUrl).hostname,
        language: "",
        wordCount: 0,
        content: "",
        browser,
        os,
        filePath,
        fileSize,
        mimeType: normalizeContentType(contentType) || undefined,
      };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        const nextBaseName =
          sanitizeBaseName(parse(fileName).name) || randomUUID();
        filePath = join(tempDir, `${nextBaseName}-${attempt}${extension}`);
        attempt += 1;
        continue;
      }

      throw error;
    }
  }

  return {
    error: `Unable to create a unique temp file for ${finalUrl}`,
    code: "download_error",
    phase: "loading",
    retryable: true,
    timeoutMs: opts.timeoutMs,
    url: opts.url,
    finalUrl,
    mimeType: normalizeContentType(contentType) || undefined,
  };
}

function shouldStripReplies(site: string): boolean {
  return (
    site === "Hacker News" ||
    site.startsWith("r/") ||
    site.startsWith("GitHub - ")
  );
}

export function getLatestChromeProfile(): string {
  return getLatestChromeProfileFrom(runtimeDependencies.getProfiles);
}

export function createDefuddleFetch(
  dependencies: FetchDependencies = runtimeDependencies,
) {
  async function fetchWithClientRedirects(
    opts: FetchOptions,
    hooks: FetchExecutionHooks,
    clientSideRedirectCount: number,
    alternateLinkFallbackCount: number,
  ): Promise<FetchResult | FetchError> {
    const browser = opts.browser ?? DEFAULT_BROWSER;
    const os = opts.os ?? DEFAULT_OS;
    const format: OutputFormat = opts.format ?? "markdown";
    const rawMaxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
    const maxChars = Math.min(Math.max(1, rawMaxChars), MAX_CHARS_CEILING);
    const removeImages = opts.removeImages ?? false;
    const includeReplies = opts.includeReplies ?? DEFAULT_INCLUDE_REPLIES;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let parsed: URL;
    try {
      parsed = new URL(opts.url);
    } catch {
      return {
        error: `Invalid URL: ${opts.url}`,
        code: "invalid_url",
        phase: "validation",
        retryable: false,
        url: opts.url,
      };
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return {
        error: `Only http/https URLs supported, got ${parsed.protocol}`,
        code: "unsupported_protocol",
        phase: "validation",
        retryable: false,
        url: opts.url,
      };
    }

    // SSRF protection: block private/internal destinations
    const ssrfError = validateUrlSafety(opts.url, { phase: "validation" });
    if (ssrfError) {
      return ssrfError;
    }

    // Filter out dangerous headers before merging
    const safeHeaders = filterUnsafeHeaders(opts.headers);

    const fetchOptions: Record<string, unknown> = {
      browser,
      os,
      headers: {
        Accept: resolveAcceptHeader(format),
        "Accept-Language": DEFAULT_ACCEPT_LANGUAGE_HEADER,
        ...safeHeaders,
      },
      redirect: "follow",
      timeout: timeoutMs,
    };

    if (opts.proxy) {
      fetchOptions.proxy = opts.proxy;
    }

    const errorContext: FetchErrorContext = {
      url: opts.url,
      phase: "connecting",
      timeoutMs,
    };

    try {
      emitProgress(hooks, {
        status: "connecting",
        progress: 0,
        phase: "fetch_start",
      });
      fetchOptions.onRequestEvent = (event: WreqLikeRequestEvent) => {
        if (event.url) {
          errorContext.finalUrl = event.url;
        }
        if (event.status) {
          errorContext.statusCode = event.status;
        }
        if (event.contentLength !== undefined && event.contentLength !== null) {
          errorContext.contentLength = event.contentLength;
        }
        if (event.downloadedBytes !== undefined) {
          errorContext.downloadedBytes = event.downloadedBytes;
        }
        if (event.type === "request_start") {
          errorContext.phase = "connecting";
        } else if (event.type === "request_sent") {
          errorContext.phase = "waiting";
        } else if (
          event.type === "response_headers" ||
          event.type === "body_progress" ||
          event.type === "body_complete"
        ) {
          errorContext.phase = "loading";
        }

        const mapped = mapRequestEventToProgress(event);
        if (mapped) {
          emitProgress(hooks, mapped);
        }
      };
      fetchOptions.captureDiagnostics = true;
      const response = await dependencies.fetch(opts.url, fetchOptions);

      errorContext.finalUrl = response.url ?? opts.url;
      errorContext.statusCode = response.status;
      errorContext.statusText = response.statusText;
      errorContext.mimeType =
        normalizeContentType(response.headers.get("content-type") ?? "") ||
        undefined;
      errorContext.contentLength =
        errorContext.contentLength ??
        parseContentLengthHeader(response.headers.get("content-length"));

      // SSRF protection: re-validate after redirect resolution
      const finalUrlForSsrf = response.url ?? opts.url;
      if (finalUrlForSsrf !== opts.url) {
        const redirectSsrfError = validateUrlSafety(finalUrlForSsrf, {
          phase: "loading",
          label: "Redirect target",
        });
        if (redirectSsrfError) {
          return redirectSsrfError;
        }
      }

      // Download size guard: reject responses with known Content-Length above limit
      if (
        errorContext.contentLength !== undefined &&
        errorContext.contentLength > MAX_DOWNLOAD_BYTES
      ) {
        return {
          error: `Response body too large (${errorContext.contentLength} bytes). Maximum allowed: ${MAX_DOWNLOAD_BYTES} bytes.`,
          code: "download_error",
          phase: "loading",
          retryable: false,
          url: opts.url,
          finalUrl: errorContext.finalUrl,
          mimeType: errorContext.mimeType,
          contentLength: errorContext.contentLength,
        };
      }

      if (!response.ok) {
        return {
          error: `Server returned HTTP ${response.status} ${response.statusText} for ${opts.url}.`,
          code: "http_error",
          phase: errorContext.phase,
          retryable: response.status >= 500 || response.status === 429,
          url: opts.url,
          finalUrl: errorContext.finalUrl,
          statusCode: response.status,
          statusText: response.statusText,
          timeoutMs,
          mimeType: errorContext.mimeType,
          contentLength: errorContext.contentLength,
        };
      }

      const finalUrl = response.url ?? opts.url;
      const contentType = response.headers.get("content-type") ?? "";
      const contentDisposition =
        response.headers.get("content-disposition") ?? "";
      const shouldDownloadToFile =
        isAttachmentDisposition(contentDisposition) ||
        !isTextualContentType(contentType);

      if (shouldDownloadToFile) {
        errorContext.phase = "loading";
        const fileResult = await buildFileResult(
          opts,
          response,
          finalUrl,
          contentType,
          contentDisposition,
          browser,
          os,
        );
        if (!isError(fileResult)) {
          emitStatus(hooks, "done");
          emitProgress(hooks, {
            status: "done",
            progress: 1,
            phase: "file_done",
          });
        }
        return fileResult;
      }

      errorContext.phase = "loading";
      const rawBody = await response.text();
      const clientSideRedirect = extractClientSideRedirect(rawBody, finalUrl);
      if (clientSideRedirect) {
        if (clientSideRedirectCount >= MAX_CLIENT_SIDE_REDIRECTS) {
          return {
            error: `Client-side redirect limit (${MAX_CLIENT_SIDE_REDIRECTS}) exceeded while fetching ${opts.url}.`,
            code: "too_many_redirects",
            phase: "loading",
            retryable: false,
            timeoutMs,
            url: opts.url,
            finalUrl,
            mimeType: normalizeContentType(contentType) || undefined,
            contentLength: errorContext.contentLength,
          };
        }

        return fetchWithClientRedirects(
          { ...opts, url: clientSideRedirect },
          hooks,
          clientSideRedirectCount + 1,
          alternateLinkFallbackCount,
        );
      }

      const jsonResponse = isJsonResponse(contentType, rawBody);

      if (format === "raw") {
        // Raw mode: skip Defuddle extraction, return full response body as-is.
        // Still call Defuddle for X/Twitter URLs so the oEmbed-based
        // deleted-tweet detection fires as a side effect.
        const isXUrl = /^https?:\/\/(www\.)?(x\.com|twitter\.com)\//i.test(
          opts.url,
        );
        if (isXUrl) {
          let extractedContent: string | undefined;
          const suppressedErrors: unknown[][] = [];
          const origConsoleError = console.error;
          console.error = (...args: unknown[]) => {
            suppressedErrors.push(args);
          };
          try {
            const extractionDocument = parseLinkedomHTML(rawBody, finalUrl);
            const extracted = await dependencies.defuddle(
              extractionDocument,
              finalUrl,
              {
                markdown: true,
                removeImages,
                includeReplies,
              },
            );
            extractedContent = extracted.content;
          } finally {
            console.error = origConsoleError;
          }

          const hasOembed404 = suppressedErrors.some((args) =>
            args.some(
              (arg) =>
                typeof arg === "string" &&
                arg.includes("oEmbed request failed: 404"),
            ),
          );
          const hasJsDisabledShell = isTwitterJsDisabledPage(
            parseLinkedomHTML(rawBody, finalUrl),
            opts.url,
          );
          // Only return 404 when a signal fires AND defuddle found no content
          if ((hasOembed404 || hasJsDisabledShell) && !extractedContent) {
            return {
              error: `Server returned HTTP 404 Not Found for ${opts.url}.`,
              code: "http_error",
              phase: "loading",
              retryable: false,
              timeoutMs,
              url: opts.url,
              finalUrl,
              statusCode: 404,
              statusText: "Not Found",
              mimeType: normalizeContentType(contentType) || undefined,
              contentLength: errorContext.contentLength,
            };
          }
        }

        // Only truncate if user explicitly set maxChars; otherwise return full body.
        const effectiveContent =
          opts.maxChars !== undefined
            ? truncateContent(rawBody, maxChars)
            : rawBody;

        const result: FetchResult = {
          kind: "content",
          url: opts.url,
          finalUrl,
          title: "",
          author: "",
          published: "",
          site: new URL(finalUrl).hostname,
          language: "",
          wordCount: 0,
          content: effectiveContent,
          browser,
          os,
          contentType: normalizeContentType(contentType) || undefined,
        };

        emitStatus(hooks, "done");
        emitProgress(hooks, {
          status: "done",
          progress: 1,
          phase: "raw_done",
        });
        return result;
      }

      if (format === "json") {
        if (!jsonResponse) {
          if (HTML_CONTENT_TYPES.some((value) => contentType.includes(value))) {
            const alternateLinks = extractQualifiedAlternateLinks(
              parseLinkedomHTML(rawBody, finalUrl),
              finalUrl,
              format,
            );
            if (
              alternateLinks.length > 0 &&
              alternateLinkFallbackCount < MAX_ALTERNATE_LINK_FALLBACKS
            ) {
              return fetchWithClientRedirects(
                { ...opts, url: alternateLinks[0] },
                hooks,
                clientSideRedirectCount,
                alternateLinkFallbackCount + 1,
              );
            }
          }

          return {
            error: `Not a JSON response (content-type: ${contentType})`,
            code: "unexpected_response",
            phase: errorContext.phase,
            retryable: false,
            timeoutMs,
            url: opts.url,
            finalUrl,
            mimeType: normalizeContentType(contentType) || undefined,
            contentLength: errorContext.contentLength,
          };
        }

        const result = buildJsonResult(
          opts,
          finalUrl,
          rawBody,
          format,
          maxChars,
          browser,
          os,
        );
        if (!isError(result)) {
          emitStatus(hooks, "done");
          emitProgress(hooks, {
            status: "done",
            progress: 1,
            phase: "json_done",
          });
        }
        return result;
      }

      if (jsonResponse) {
        const result = buildJsonResult(
          opts,
          finalUrl,
          rawBody,
          format,
          maxChars,
          browser,
          os,
        );
        if (!isError(result)) {
          emitStatus(hooks, "done");
          emitProgress(hooks, {
            status: "done",
            progress: 1,
            phase: "json_done",
          });
        }
        return result;
      }

      if (isPlainTextContentType(contentType)) {
        const result = buildPlainTextResult(
          opts,
          finalUrl,
          rawBody,
          format,
          maxChars,
          browser,
          os,
        );
        emitStatus(hooks, "done");
        emitProgress(hooks, {
          status: "done",
          progress: 1,
          phase: "plain_text_done",
        });
        return result;
      }

      if (!HTML_CONTENT_TYPES.some((value) => contentType.includes(value))) {
        return {
          error: `Not an HTML page (content-type: ${contentType})`,
          code: "unexpected_response",
          phase: errorContext.phase,
          retryable: false,
          timeoutMs,
          url: opts.url,
          finalUrl,
          mimeType: normalizeContentType(contentType) || undefined,
          contentLength: errorContext.contentLength,
        };
      }

      errorContext.phase = "processing";
      emitStatus(hooks, "processing");
      emitProgress(hooks, {
        status: "processing",
        progress: 0.96,
        phase: "extracting",
      });
      const fallbackDocument = parseLinkedomHTML(rawBody, finalUrl);
      const extractionDocument = parseLinkedomHTML(rawBody, finalUrl);
      const alternateLinks = extractQualifiedAlternateLinks(
        fallbackDocument,
        finalUrl,
        format,
      );

      const tryAlternateLinkFallback = async () => {
        if (
          alternateLinks.length === 0 ||
          alternateLinkFallbackCount >= MAX_ALTERNATE_LINK_FALLBACKS
        ) {
          return null;
        }

        return fetchWithClientRedirects(
          { ...opts, url: alternateLinks[0] },
          hooks,
          clientSideRedirectCount,
          alternateLinkFallbackCount + 1,
        );
      };

      let extracted: Awaited<ReturnType<typeof dependencies.defuddle>>;
      const suppressedErrors: unknown[][] = [];
      try {
        // Defuddle's async extractors (e.g. X oEmbed) can throw on 404 and
        // log a noisy "Error in async extraction" via console.error. Suppress
        // that spam by intercepting console.error during the defuddle call.
        // We also capture the suppressed errors for later analysis.
        const origConsoleError = console.error;
        console.error = (...args: unknown[]) => {
          suppressedErrors.push(args);
        };
        try {
          extracted = await dependencies.defuddle(
            extractionDocument,
            finalUrl,
            {
              markdown: format !== "html",
              removeImages,
              includeReplies,
            },
          );
        } finally {
          console.error = origConsoleError;
        }
      } catch (_error) {
        extracted = {
          content: undefined,
          wordCount: 0,
        } as Awaited<ReturnType<typeof dependencies.defuddle>>;
      }

      // Detect X/Twitter deleted/protected tweets using two signals:
      // 1. Defuddle's oEmbed extractor failed with a 404 (captured from
      //    suppressed console.error)
      // 2. The page is an X/Twitter "JS disabled" shell (DOM detection)
      // When either signal fires on an x.com/twitter.com URL, surface a
      // proper 404 instead of the JS-disabled boilerplate as "content".
      const isXUrl = /^https?:\/\/(www\.)?(x\.com|twitter\.com)\//i.test(
        opts.url,
      );
      if (isXUrl) {
        const hasOembed404 = suppressedErrors.some((args) =>
          args.some(
            (arg) =>
              typeof arg === "string" &&
              arg.includes("oEmbed request failed: 404"),
          ),
        );
        const hasJsDisabledShell = isTwitterJsDisabledPage(
          fallbackDocument,
          opts.url,
        );
        if ((hasOembed404 || hasJsDisabledShell) && !extracted.content) {
          return {
            error: `Server returned HTTP 404 Not Found for ${opts.url}.`,
            code: "http_error",
            phase: "loading",
            retryable: false,
            timeoutMs,
            url: opts.url,
            finalUrl,
            statusCode: 404,
            statusText: "Not Found",
            mimeType: normalizeContentType(contentType) || undefined,
            contentLength: errorContext.contentLength,
          };
        }
      }

      let extractedContent = extracted.content;
      let wordCount = extracted.wordCount;

      if (!extractedContent || wordCount === 0) {
        const fallbackText = extractDomTextFallback(fallbackDocument);
        if (!fallbackText) {
          const alternateResult = await tryAlternateLinkFallback();
          if (alternateResult) return alternateResult;

          return {
            error: `No content extracted from ${opts.url}. May need JS rendering or is blocked.`,
            code: "no_content",
            phase: "processing",
            retryable: false,
            timeoutMs,
            url: opts.url,
            finalUrl,
            mimeType: normalizeContentType(contentType) || undefined,
            contentLength: errorContext.contentLength,
          };
        }

        extractedContent =
          format === "html"
            ? rawBody
            : format === "markdown"
              ? extractDomMarkdownFallback(fallbackDocument) || fallbackText
              : fallbackText;
        wordCount = estimateWordCount(fallbackText);
      }

      const extractedTextWordCount = estimateWordCount(
        format === "text" ? extractedContent : markdownToText(extractedContent),
      );
      if (
        Math.min(wordCount, extractedTextWordCount) <
          MIN_EXTRACTED_WORDS_BEFORE_ALTERNATE_FALLBACK &&
        alternateLinks.length > 0
      ) {
        const alternateResult = await tryAlternateLinkFallback();
        if (alternateResult) return alternateResult;
      }

      if (
        includeReplies === false &&
        shouldStripReplies(extracted.site ?? "")
      ) {
        const strippedContent = stripExtractorComments(
          extractedContent,
          format,
        );
        if (strippedContent !== extractedContent) {
          extractedContent = strippedContent;
          wordCount = estimateWordCount(
            format === "text"
              ? markdownToText(extractedContent)
              : extractedContent,
          );
        }
      }

      const normalizedContent =
        format === "text" ? markdownToText(extractedContent) : extractedContent;

      const result: FetchResult = {
        kind: "content",
        url: opts.url,
        finalUrl,
        title: extracted.title ?? "",
        author: extracted.author ?? "",
        published: extracted.published ?? "",
        site: extracted.site ?? "",
        language: extracted.language ?? "",
        wordCount,
        content: truncateContent(normalizedContent, maxChars),
        browser,
        os,
      };

      emitStatus(hooks, "done");
      emitProgress(hooks, { status: "done", progress: 1, phase: "done" });
      return result;
    } catch (error) {
      const fetchError = buildThrownFetchError(error, errorContext);
      emitStatus(hooks, "error");
      emitProgress(hooks, { status: "error", progress: 1, phase: "error" });
      return fetchError;
    }
  }

  return function defuddleFetch(
    opts: FetchOptions,
    hooks: FetchExecutionHooks = {},
  ): Promise<FetchResult | FetchError> {
    return fetchWithClientRedirects(opts, hooks, 0, 0);
  };
}

export const defuddleFetch = createDefuddleFetch();

/** Type guard: check if result is an error. */
export function isError(
  result: FetchResult | FetchError,
): result is FetchError {
  return "error" in result;
}
