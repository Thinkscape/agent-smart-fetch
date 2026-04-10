export type OutputFormat = "markdown" | "html" | "text" | "json";
export type FingerprintOs = "windows" | "macos" | "linux" | "android" | "ios";
export type IncludeRepliesOption = boolean | "extractors";
export type BatchFetchItemStatus =
  | "queued"
  | "fetching"
  | "extracting"
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
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  title: string;
  author: string;
  published: string;
  site: string;
  language: string;
  wordCount: number;
  content: string;
  browser: string;
  os: string;
}

export interface FetchError {
  error: string;
}

export interface BatchFetchItemProgress {
  index: number;
  url: string;
  status: BatchFetchItemStatus;
  progress: number;
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
  text(): Promise<string>;
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
}

export interface FetchToolDefaults {
  maxChars: number;
  timeoutMs: number;
  browser: string;
  os: string;
  removeImages: boolean;
  includeReplies: IncludeRepliesOption;
  batchConcurrency: number;
}

export interface FetchExecutionHooks {
  onStatusChange?(status: Exclude<BatchFetchItemStatus, "queued">): void;
}
