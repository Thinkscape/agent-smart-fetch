import type { FingerprintOs } from "./types";

export const DEFAULT_BROWSER = "chrome_145";
export const DEFAULT_OS: FingerprintOs = "windows";
export const DEFAULT_MAX_CHARS = 50_000;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_BATCH_CONCURRENCY = 8;
export const DEFAULT_INCLUDE_REPLIES = "extractors" as const;
export const DEFAULT_ACCEPT_HEADER =
  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
export const DEFAULT_JSON_ACCEPT_HEADER =
  "application/json,text/json,application/ld+json;q=0.9,text/plain;q=0.8,*/*;q=0.7";
export const DEFAULT_ACCEPT_LANGUAGE_HEADER = "en-US,en;q=0.9";
