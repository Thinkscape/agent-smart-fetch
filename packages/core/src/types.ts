export type OutputFormat = "markdown" | "html" | "text" | "json" | "raw";
export type FingerprintOs = "windows" | "macos" | "linux" | "android" | "ios";
export type IncludeRepliesOption = boolean | "extractors";
export type BatchFetchItemStatus =
  | "queued"
  | "connecting"
  | "waiting"
  | "loading"
  | "processing"
  | "done"
  | "error";

export interface FetchOptions {
  url: string;
  browser?: string;
  os?: FingerprintOs | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
  maxChars?: number;
  maxResponseBytes?: number;
  removeImages?: boolean;
  includeReplies?: IncludeRepliesOption;
  proxy?: string;
  timeoutMs?: number;
  tempDir?: string;
}

interface BaseFetchResult {
  url: string;
  finalUrl: string;
  title: string;
  author: string;
  published: string;
  site: string;
  language: string;
  wordCount: number;
  browser: string;
  os: string;
  contentType?: string;
}

export interface ResponseTruncation {
  bytesRead: number;
  /** Declared Content-Length, when the server sent one. */
  contentLength?: number;
}

export interface ContentFetchResult extends BaseFetchResult {
  kind: "content";
  content: string;
  /** Set when the body was longer than maxResponseBytes; only a prefix was read. */
  responseTruncated?: ResponseTruncation;
}

export interface FileFetchResult extends BaseFetchResult {
  kind: "file";
  content: "";
  filePath: string;
  fileSize: number;
  mimeType?: string;
}

export type FetchResult = ContentFetchResult | FileFetchResult;

export type FetchErrorCode =
  | "invalid_url"
  | "unsupported_protocol"
  | "http_error"
  | "unexpected_response"
  | "timeout"
  | "network_error"
  | "processing_error"
  | "download_error"
  | "no_content"
  | "too_many_redirects"
  | "response_too_large";

export type FetchErrorPhase =
  | "validation"
  | "connecting"
  | "waiting"
  | "loading"
  | "processing"
  | "unknown";

export interface FetchError {
  error: string;
  code?: FetchErrorCode;
  phase?: FetchErrorPhase;
  retryable?: boolean;
  timeoutMs?: number;
  url?: string;
  finalUrl?: string;
  statusCode?: number;
  statusText?: string;
  mimeType?: string;
  contentLength?: number;
  downloadedBytes?: number;
  maxResponseBytes?: number;
}

export interface BatchFetchItemProgress {
  index: number;
  url: string;
  status: BatchFetchItemStatus;
  progress: number;
  statusStartedAt?: number;
  error?: string;
}

export interface BatchFetchItemResult {
  index: number;
  request: FetchOptions;
  status: "done" | "error";
  progress: number;
  result?: FetchResult;
  error?: string;
}

export interface BatchFetchProgressSnapshot {
  items: BatchFetchItemProgress[];
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  batchConcurrency: number;
}

export interface BatchFetchResult {
  items: BatchFetchItemResult[];
  total: number;
  succeeded: number;
  failed: number;
  batchConcurrency: number;
}

export interface ExtractedContent {
  content?: string;
  wordCount: number;
  title?: string;
  author?: string;
  published?: string;
  site?: string;
  language?: string;
  extractorType?: string;
}

/**
 * Minimal subset of ReadableStreamDefaultReader used by this package.
 * Avoids coupling to a specific ReadableStream global (DOM vs node:stream/web)
 * which have incompatible BYOB-reader overloads.
 */
export interface BodyStreamReader<T> {
  read(): Promise<{ done: boolean; value?: T }>;
  cancel(reason?: string): Promise<void>;
  releaseLock(): void;
}

/**
 * Minimal subset of ReadableStream used by this package.
 * Structurally compatible with both the DOM global ReadableStream and
 * Node's `node:stream/web`.ReadableStream — no double-cast needed.
 */
export interface ReadableBodyStream<T> {
  getReader(): BodyStreamReader<T>;
  readonly locked: boolean;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  headers: {
    get(name: string): string | null;
  };
  body: ReadableBodyStream<Uint8Array> | null;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  readable(): NodeJS.ReadableStream;
}

export interface HtmlAnalysisRequest {
  html: string;
  /** URL the document was served from, after redirects. */
  url: string;
  /** URL the caller asked for; X/Twitter shell detection keys off it. */
  requestUrl: string;
  /** Requested output format; decides which alternate links qualify. */
  format: OutputFormat;
  /** Defuddle options. Omit to only read alternate links and page signals. */
  extract?: {
    markdown: boolean;
    removeImages: boolean;
    includeReplies: IncludeRepliesOption;
  };
  /** DOM fallback to render when Defuddle finds no content. */
  fallback?: "text" | "markdown";
}

export interface HtmlAnalysis {
  alternateLinks: string[];
  isXJsDisabledShell: boolean;
  extraction?: {
    extracted: ExtractedContent;
    /** Message of the error Defuddle threw, if it threw. */
    error?: string;
    /** String arguments of each console.error call made during extraction. */
    consoleErrors: string[][];
    /** Fallback rendered from an unmodified parse of the page. */
    fallback?: { text: string; markdown?: string };
  };
}

export interface FetchDependencies {
  fetch(
    url: string,
    options: Record<string, unknown>,
  ): Promise<FetchResponseLike>;
  defuddle(
    document: Document,
    url: string,
    options: Record<string, unknown>,
  ): Promise<ExtractedContent>;
  getProfiles(): string[];
  /**
   * Parses and extracts an HTML body. When set, `defuddle` is not called by
   * the pipeline; without it, extraction runs in-process with `defuddle`. The
   * runtime dependencies run it on a worker thread that is terminated after
   * `timeoutMs`.
   */
  analyzeHtml?(
    request: HtmlAnalysisRequest,
    options: { timeoutMs: number },
  ): Promise<HtmlAnalysis>;
}

export interface FetchToolConfig {
  maxChars?: number;
  maxResponseBytes?: number;
  timeoutMs?: number;
  browser?: string;
  os?: string;
  removeImages?: boolean;
  includeReplies?: IncludeRepliesOption;
  batchConcurrency?: number;
  tempDir?: string;
}

export interface FetchToolDefaults {
  maxChars: number;
  maxResponseBytes: number;
  timeoutMs: number;
  browser: string;
  os: string;
  removeImages: boolean;
  includeReplies: IncludeRepliesOption;
  batchConcurrency: number;
  tempDir?: string;
}

export interface FetchProgressUpdate {
  status: Exclude<BatchFetchItemStatus, "queued">;
  progress: number;
  phase?: string;
}

export interface FetchExecutionHooks {
  onStatusChange?(status: Exclude<BatchFetchItemStatus, "queued">): void;
  onProgressChange?(update: FetchProgressUpdate): void;
}
