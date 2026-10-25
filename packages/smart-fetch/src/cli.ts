/**
 * smart-fetch CLI
 *
 * Fetch web pages with desktop-browser TLS fingerprinting and
 * content extraction via Defuddle.
 *
 * Usage:
 *   smart-fetch [options] <url>             Fetch a single URL
 *   smart-fetch [options] <url> <url> ...   Fetch multiple URLs (batch)
 *   smart-fetch [options] --file <path>     Read URLs from a file (batch)
 *   smart-fetch [options] --stdin           Read URLs from stdin (batch)
 *   smart-fetch --help
 *   smart-fetch --version
 */

import {
  createReadStream,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { isatty } from "node:tty";
import type {
  BatchFetchProgressSnapshot,
  FetchResult,
  FetchToolConfig,
} from "smart-fetch-core";
import {
  buildFetchResponseText,
  defuddleFetch,
  describeResponseTruncation,
  executeBatchFetchToolCall,
  isError,
  isFileFetchResult,
  resolveFetchToolDefaults,
} from "smart-fetch-core";

// ─── Pipe detection ────────────────────────────────────────────────────────

/** Detect if stdout is being piped/redirected (not a terminal).
 *  Uses tty.isatty(fd) — the canonical Node.js check. */
function isStdoutPiped(): boolean {
  return !isatty(1);
}

// ─── Constants ───────────────────────────────────────────────────────────────

const HELP = `smart-fetch - Fetch web pages with desktop-browser TLS fingerprinting.

USAGE
  smart-fetch [options] <url>             Fetch a single URL
  smart-fetch [options] <url> <url> ...   Fetch multiple URLs (batch)
  smart-fetch [options] --file <path>     Read URLs from a file (batch)
  smart-fetch [options] --stdin           Read URLs from stdin (batch)
  smart-fetch --help                      Show this help
  smart-fetch --version                   Show version

OPTIONS
  --browser <name>       Browser profile for TLS fingerprinting
                         Default: chrome_145
                         Examples: chrome_145, firefox_147, safari_26,
                                   edge_145, opera_127

  --os <name>            OS profile for fingerprinting
                         Default: windows
                         Options: windows, macos, linux, android, ios

  --format <fmt>         Output format
                         Default: markdown
                         Options: markdown, html, text, json

  --html                 Shorthand for --format html
  --json                 Shorthand for --format json
  --text                 Shorthand for --format text
  --raw                  Shorthand for --format raw

  --max-chars <n>        Maximum characters to return
                         Default: 50000

  --max-response-bytes <n>
                         Maximum bytes of a text response to read; longer
                         pages are cut before extraction
                         Default: 1048576; a single --raw fetch reads
                         everything

  --timeout <ms>         Timeout in milliseconds for the request, and again
                         for content extraction
                         Default: 15000

  --remove-images        Strip image references from output

  --include-replies <mode>  Include replies/comments
                            Default: extractors
                            Options: true, false, extractors

  --proxy <url>          Proxy URL (http://user:pass@host:port or socks5://...)

  --verbose              Include full metadata header in output

  --concurrency <n>      Max concurrent requests for batch mode
                         Default: 8

  --output <dir>         Write results to files in <dir> instead of stdout
                         Files are named {index}-{slug}.{ext}

  --no-progress          Disable progress output in batch mode (stderr)

EXAMPLES
  smart-fetch https://example.com
  smart-fetch https://example.com --format text --verbose
  smart-fetch https://example.com --raw
  smart-fetch https://example.com https://other.com
  smart-fetch --file urls.txt --concurrency 4 --output ./fetched
  cat urls.txt | smart-fetch --stdin
`;

// ─── Argument parsing ───────────────────────────────────────────────────────

interface CliOptions {
  help: boolean;
  version: boolean;
  urls: string[];
  browser?: string;
  os?: string;
  format?: "markdown" | "html" | "text" | "json" | "raw";
  maxChars?: number;
  maxResponseBytes?: number;
  timeout?: number;
  removeImages: boolean;
  includeReplies?: "true" | "false" | "extractors";
  proxy?: string;
  verbose: boolean;
  concurrency?: number;
  output?: string;
  file?: string;
  stdin: boolean;
  noProgress: boolean;
}

function parseCliArgs(rawArgs: string[]): CliOptions {
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};

  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      i++;
    } else if (arg === "--version" || arg === "-v") {
      options.version = true;
      i++;
    } else if (arg === "--verbose") {
      options.verbose = true;
      i++;
    } else if (arg === "--html") {
      options.format = "html";
      i++;
    } else if (arg === "--json") {
      options.format = "json";
      i++;
    } else if (arg === "--text") {
      options.format = "text";
      i++;
    } else if (arg === "--raw") {
      options.format = "raw";
      i++;
    } else if (arg === "--remove-images") {
      options["remove-images"] = true;
      i++;
    } else if (arg === "--stdin") {
      options.stdin = true;
      i++;
    } else if (arg === "--no-progress") {
      options["no-progress"] = true;
      i++;
    } else if (
      arg.startsWith("--") &&
      i + 1 < rawArgs.length &&
      !rawArgs[i + 1].startsWith("-")
    ) {
      options[arg.slice(2)] = rawArgs[i + 1];
      i += 2;
    } else if (arg.startsWith("-")) {
      // unknown flag
      console.error(`Unknown option: ${arg}`);
      process.exit(2);
    } else {
      positionals.push(arg);
      i++;
    }
  }

  let urls = positionals;

  // Filter out legacy subcommands if accidentally provided
  if (
    urls.length > 0 &&
    (urls[0] === "fetch" || urls[0] === "batch" || urls[0] === "help")
  ) {
    if (urls[0] === "help") options.help = true;
    urls = urls.slice(1);
  }

  const formatRaw = options.format as string | undefined;
  const format = ["markdown", "html", "text", "json", "raw"].includes(
    formatRaw ?? "",
  )
    ? (formatRaw as CliOptions["format"])
    : undefined;

  const includeRepliesRaw = options["include-replies"] as string | undefined;
  const includeReplies = ["true", "false", "extractors"].includes(
    includeRepliesRaw ?? "",
  )
    ? (includeRepliesRaw as CliOptions["includeReplies"])
    : undefined;

  return {
    help: options.help === true,
    version: options.version === true,
    urls: urls.filter((u) => u.length > 0),
    browser: options.browser as string | undefined,
    os: options.os as string | undefined,
    format,
    maxChars: options["max-chars"] ? Number(options["max-chars"]) : undefined,
    maxResponseBytes: options["max-response-bytes"]
      ? Number(options["max-response-bytes"])
      : undefined,
    timeout: options.timeout ? Number(options.timeout) : undefined,
    removeImages: options["remove-images"] === true,
    includeReplies,
    proxy: options.proxy as string | undefined,
    verbose: options.verbose === true,
    concurrency: options.concurrency ? Number(options.concurrency) : undefined,
    output: options.output as string | undefined,
    file: options.file as string | undefined,
    stdin: options.stdin === true,
    noProgress: options["no-progress"] === true,
  };
}

// ─── Resolve URLs for batch ─────────────────────────────────────────────────

function readUrlsFromFile(path: string): string[] {
  const content = readFileSync(path, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

async function readUrlsFromStdin(): Promise<string[]> {
  const rl = createInterface({ input: process.stdin });
  const lines: string[] = [];
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && !trimmed.startsWith("#")) {
      lines.push(trimmed);
    }
  }
  return lines;
}

async function resolveBatchUrls(opts: CliOptions): Promise<string[]> {
  if (opts.file) {
    return readUrlsFromFile(opts.file);
  }
  if (opts.stdin) {
    return readUrlsFromStdin();
  }
  return opts.urls;
}

// ─── Config ─────────────────────────────────────────────────────────────────

function resolveFetchToolConfig(cliOpts: CliOptions): FetchToolConfig {
  return {
    browser: cliOpts.browser,
    os: cliOpts.os,
    maxChars: cliOpts.maxChars,
    maxResponseBytes: cliOpts.maxResponseBytes,
    timeoutMs: cliOpts.timeout,
    removeImages: cliOpts.removeImages || undefined,
    includeReplies: cliOpts.includeReplies
      ? cliOpts.includeReplies === "true"
        ? true
        : cliOpts.includeReplies === "false"
          ? false
          : "extractors"
      : undefined,
    batchConcurrency: cliOpts.concurrency,
  };
}

// ─── Output helpers ─────────────────────────────────────────────────────────

function buildMetadataForPipe(result: FetchResult): string {
  // Only emit Content-Type + URL when in raw mode.
  const lines: string[] = [];
  if (result.contentType) {
    lines.push(`> Content-Type: ${result.contentType}`);
  }
  lines.push(`> URL: ${result.finalUrl}`);
  const truncation = describeResponseTruncation(result);
  if (truncation) {
    lines.push(`> Truncated: ${truncation}`);
  }
  return lines.join("\n");
}

function slugify(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    const parts = [hostname, ...pathname.split("/").filter(Boolean)];
    return (
      parts
        .join("-")
        .replace(/[^a-zA-Z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80) || "index"
    );
  } catch {
    return "unknown";
  }
}

function writeResultToFile(
  result: FetchResult,
  index: number,
  outputDir: string,
  opts: CliOptions,
): string {
  mkdirSync(outputDir, { recursive: true });
  const text = buildFetchResponseText(result, { verbose: opts.verbose });
  const ext =
    opts.format === "html" ? "html" : opts.format === "json" ? "json" : "md";
  const slug = slugify(result.finalUrl);
  const filename = `${String(index).padStart(2, "0")}-${slug}.${ext}`;
  const filepath = join(outputDir, filename);
  writeFileSync(filepath, text, "utf-8");
  return filepath;
}

// ─── Progress display ───────────────────────────────────────────────────────

const STATUS_SYMBOLS: Record<string, string> = {
  queued: "⏳",
  connecting: "🔗",
  waiting: "⏱️",
  loading: "⬇️",
  processing: "⚙️",
  done: "✅",
  error: "❌",
};

function formatProgress(snapshot: BatchFetchProgressSnapshot): string {
  const lines = snapshot.items.map((item) => {
    const symbol = STATUS_SYMBOLS[item.status] || "  ";
    const urlDisplay =
      item.url.length > 60 ? `${item.url.slice(0, 57)}...` : item.url;
    const errorHint = item.error ? ` - ${item.error}` : "";
    return `  ${symbol} [${item.status}] ${urlDisplay}${errorHint}`;
  });
  return `${lines.join("\n")}\n  ── ${snapshot.succeeded} succeeded, ${snapshot.failed} failed, ${snapshot.total - snapshot.completed} remaining (${snapshot.batchConcurrency} concurrent)`;
}

// ─── Main commands ──────────────────────────────────────────────────────────

async function runFetch(opts: CliOptions): Promise<void> {
  const piped = isStdoutPiped();
  const isRaw = opts.format === "raw";

  if (opts.urls.length === 0) {
    console.error("Error: No URL provided. Use --help for usage.");
    process.exit(1);
  }

  const url = opts.urls[0];
  const config = resolveFetchToolConfig(opts);
  const defaults = resolveFetchToolDefaults(config);

  // For raw mode, don't apply default maxChars — only truncate if user
  // explicitly passed --max-chars.
  const effectiveMaxChars =
    isRaw && opts.maxChars === undefined
      ? undefined
      : (opts.maxChars ?? defaults.maxChars);

  const result = await defuddleFetch({
    url,
    browser: defaults.browser,
    os: defaults.os,
    format: opts.format ?? "markdown",
    maxChars: effectiveMaxChars,
    maxResponseBytes: opts.maxResponseBytes,
    timeoutMs: defaults.timeoutMs,
    removeImages: defaults.removeImages || opts.removeImages,
    includeReplies: defaults.includeReplies,
    proxy: opts.proxy,
  });

  if (isError(result)) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  if (opts.output) {
    const filepath = writeResultToFile(result, 1, opts.output, opts);
    if (!piped) console.log(`Saved to ${filepath}`);
  } else if (piped) {
    // When piping, stream content to stdout and metadata to stderr.
    if (isFileFetchResult(result)) {
      const metadata = buildFetchResponseText(result, {
        verbose: opts.verbose,
      });
      process.stderr.write(`${metadata}\n`);
      const readStream = createReadStream(result.filePath);
      readStream.pipe(process.stdout);
      await new Promise<void>((resolve, reject) => {
        readStream.on("end", resolve);
        readStream.on("error", reject);
      });
    } else if (isRaw) {
      // Raw mode: metadata to stderr, raw body to stdout.
      const metadata = buildMetadataForPipe(result);
      if (metadata) process.stderr.write(`${metadata}\n`);
      process.stdout.write(result.content);
    } else {
      const output = buildFetchResponseText(result, { verbose: opts.verbose });
      console.log(output);
    }
  } else {
    const output = buildFetchResponseText(result, { verbose: opts.verbose });
    console.log(output);
  }
}

async function runBatch(opts: CliOptions): Promise<void> {
  const piped = isStdoutPiped();

  const urls = await resolveBatchUrls(opts);

  if (urls.length === 0) {
    console.error("Error: No URLs provided for batch. Use --help for usage.");
    process.exit(1);
  }

  const config = resolveFetchToolConfig(opts);
  const defaults = resolveFetchToolDefaults(config);

  const requests = urls.map((url) => ({ url }));

  if (opts.browser) {
    for (const r of requests)
      (r as Record<string, unknown>).browser = opts.browser;
  }
  if (opts.os) {
    for (const r of requests) (r as Record<string, unknown>).os = opts.os;
  }
  if (opts.format) {
    for (const r of requests)
      (r as Record<string, unknown>).format = opts.format;
  }
  if (opts.maxChars !== undefined) {
    for (const r of requests)
      (r as Record<string, unknown>).maxChars = opts.maxChars;
  }
  if (opts.timeout !== undefined) {
    for (const r of requests)
      (r as Record<string, unknown>).timeoutMs = opts.timeout;
  }
  if (opts.removeImages) {
    for (const r of requests)
      (r as Record<string, unknown>).removeImages = true;
  }
  if (opts.includeReplies) {
    const val =
      opts.includeReplies === "true"
        ? true
        : opts.includeReplies === "false"
          ? false
          : "extractors";
    for (const r of requests)
      (r as Record<string, unknown>).includeReplies = val;
  }
  if (opts.proxy) {
    for (const r of requests) (r as Record<string, unknown>).proxy = opts.proxy;
  }

  let lastProgressLines = 0;

  const result = await executeBatchFetchToolCall(
    { requests } as Record<string, unknown>,
    defaults,
    {
      batchConcurrency: opts.concurrency ?? defaults.batchConcurrency,
      onProgress(snapshot) {
        if (opts.noProgress || piped) return;
        // Clear previous progress lines
        if (lastProgressLines > 0) {
          process.stderr.write(`\x1b[${lastProgressLines}A\x1b[J`);
        }
        const output = formatProgress(snapshot);
        process.stderr.write(`${output}\n`);
        lastProgressLines = output.split("\n").length;
      },
    },
  );

  // Clear final progress display
  if (!opts.noProgress && !piped && lastProgressLines > 0) {
    process.stderr.write(`\x1b[${lastProgressLines}A\x1b[J`);
  }

  // Output results
  if (opts.output) {
    for (const item of result.items) {
      if (item.status === "done" && item.result) {
        const filepath = writeResultToFile(
          item.result,
          item.index + 1,
          opts.output,
          opts,
        );
        if (!piped)
          console.log(`[${item.index + 1}/${result.total}] ${filepath}`);
      } else if (!piped) {
        console.log(
          `[${item.index + 1}/${result.total}] ERROR: ${item.error ?? "Unknown error"}`,
        );
      }
    }
  } else if (piped) {
    // Piped stdout: content to stdout, metadata to stderr.
    for (const item of result.items) {
      if (item.status !== "done" || !item.result) continue;
      if (item.index > 0) process.stdout.write("\n");
      if (isFileFetchResult(item.result)) {
        // Stream binary file to stdout, metadata to stderr.
        const metadata = buildFetchResponseText(item.result, {
          verbose: opts.verbose,
        });
        process.stderr.write(`${metadata}\n`);
        const readStream = createReadStream(item.result.filePath);
        readStream.pipe(process.stdout);
        await new Promise<void>((resolve, reject) => {
          readStream.on("end", resolve);
          readStream.on("error", reject);
        });
      } else if (opts.format === "raw") {
        // Raw mode: metadata to stderr, raw body to stdout.
        const metadata = buildMetadataForPipe(item.result);
        if (metadata) process.stderr.write(`${metadata}\n`);
        process.stdout.write(item.result.content);
      } else {
        console.log(
          buildFetchResponseText(item.result, { verbose: opts.verbose }),
        );
      }
    }
  } else {
    for (const item of result.items) {
      if (item.status === "done" && item.result) {
        const output = buildFetchResponseText(item.result, {
          verbose: opts.verbose,
        });
        // Add a separator between items
        if (item.index > 0) console.log("\n---\n");
        console.log(
          `[${item.index + 1}/${result.total}] ${item.result.finalUrl}`,
        );
        console.log(output);
      } else {
        if (item.index > 0) console.log("\n---\n");
        console.log(`[${item.index + 1}/${result.total}] ${item.request.url}`);
        console.log(`ERROR: ${item.error ?? "Unknown error"}`);
      }
    }
  }

  // Final summary to stderr (skip when piped — consumer doesn't want noise)
  if (!piped) {
    console.error(
      `\n${result.succeeded} succeeded, ${result.failed} failed of ${result.total} total`,
    );
  }
}

// ─── Entry ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const opts = parseCliArgs(rawArgs);

  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (opts.version) {
    try {
      const pkg = JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
      );
      console.log(pkg.version);
    } catch {
      console.log("unknown");
    }
    process.exit(0);
  }

  // Determine mode: 1 positional URL → single fetch, multiple → batch.
  // --file and --stdin always trigger batch mode.
  const isBatch = opts.file !== undefined || opts.stdin || opts.urls.length > 1;

  if (isBatch) {
    await runBatch(opts);
    return;
  }

  if (opts.urls.length === 1) {
    await runFetch(opts);
    return;
  }

  // No URLs provided.
  if (rawArgs.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  console.error("Error: No URL provided. Use --help for usage.");
  process.exit(1);
}

main().catch((err) => {
  console.error(
    `Fatal error: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
