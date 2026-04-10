export type OutputFormat = "markdown" | "html" | "text";
export type FingerprintOs = "windows" | "macos" | "linux" | "android" | "ios";
export type IncludeRepliesOption = boolean | "extractors";

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

export interface ExtractedContent {
  content?: string;
  wordCount: number;
  title?: string;
  author?: string;
  published?: string;
  site?: string;
  language?: string;
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
}

export interface FetchToolDefaults {
  maxChars: number;
  timeoutMs: number;
  browser: string;
  os: string;
  removeImages: boolean;
  includeReplies: IncludeRepliesOption;
}
