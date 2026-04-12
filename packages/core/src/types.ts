export type OutputFormat = "markdown" | "html" | "text" | "json";
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
}

export interface ContentFetchResult extends BaseFetchResult {
  kind: "content";
  content: string;
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
  | "no_content";

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

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  url?: string;
  headers: {
    get(name: string): string | null;
  };
  body?: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
  readable?(): NodeJS.ReadableStream;
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
}

export interface FetchToolConfig {
  maxChars?: number;
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
