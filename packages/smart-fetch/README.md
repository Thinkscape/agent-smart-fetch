# @thinkscape/smart-fetch

Smart web fetching CLI with desktop-browser TLS fingerprinting and
[Defuddle](https://github.com/Thinkscape/defuddle) extraction.

## Features

- 🔐 **Browser-like TLS/SSL + HTTP fingerprints** — better success on bot-defended pages
- 🧹 **Defuddle extraction** — clean readable content instead of noisy HTML
- 🧠 **Useful metadata** — title, author, site, language, published date when available
- 📦 **Downloads + large file support** — stream attachments and binaries to temp files
- 🔁 **Client-side `<meta>` redirects** — follows sane meta refresh redirects with loop limits
- 🔗 **Alternate content fallback** — when extraction produces no/thin content, follows qualified `<link rel="alternate" type="...">` entries in `<head>` that match the requested output format
- ⚡ **Batch fetch** — fetch many URLs with bounded concurrency and live progress
- 📝 **Multiple output formats** — `markdown`, `html`, `text`, `json`, `raw`
- 📟 **Pipe-friendly** — auto-detects piped stdout, suppresses progress and metadata noise
- ⚡ **Shorthand alias** — use `sf` instead of `smart-fetch`

## Site optimisations

This CLI works on general web pages, but some site types benefit especially from Defuddle's extractors and cleanup:

- YouTube pages and transcripts
- Reddit posts and comment threads
- X / Twitter posts
- GitHub pages, issues, PRs, and discussions
- Hacker News threads
- Substack posts
- Pages with code blocks, footnotes, math, and callouts

Notes:
- Defuddle is the cleanup layer: it strips common page chrome like nav, sidebars, related links, share widgets, and footers
- It does **not** execute JavaScript or solve interactive anti-bot/login flows
- If an HTML shell advertises alternate content in `<head>`, smart-fetch can follow matching alternates such as `text/markdown`, `text/plain`, `text/html`, or JSON media types according to the requested `format`

## Install

```bash
npm install -g @thinkscape/smart-fetch
# or
bun install -g @thinkscape/smart-fetch
```

Two binaries are installed: `smart-fetch` and the shorthand `sf`.

## Usage

### Single URL

```bash
smart-fetch https://example.com
sf https://example.com              # shorthand alias
smart-fetch https://example.com --format text --verbose
smart-fetch https://api.example.com/data --format json
```

### Batch mode

```bash
# Direct URLs
sf batch https://example.com https://other.com

# From file (one URL per line)
smart-fetch batch --file urls.txt

# From stdin
cat urls.txt | sf batch --stdin

# With custom concurrency and output to files
sf batch --file urls.txt --concurrency 4 --output ./fetched
```

### Pipes

When stdout is piped to another command, the CLI automatically suppresses
progress and metadata headers — only the raw extracted content goes through:

```bash
# Search extracted content across multiple pages
sf batch --file urls.txt | grep "keyword"

# Count words across fetched pages
sf https://example.com --format text | wc -w
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--browser <name>` | Browser profile for TLS fingerprinting | `chrome_145` |
| `--os <name>` | OS profile | `windows` |
| `--format <fmt>` | Output format: `markdown`, `html`, `text`, `json`, `raw` | `markdown` |
| `--max-chars <n>` | Max characters to return | `50000` |
| `--max-response-bytes <n>` | Max bytes of a text response to read; longer pages are cut before extraction (a single `--raw` fetch reads everything unless set) | `1048576` |
| `--timeout <ms>` | Request timeout in milliseconds; content extraction gets the same budget | `15000` |
| `--remove-images` | Strip image references from output | off |
| `--include-replies <mode>` | Include replies: `true`, `false`, `extractors` | `extractors` |
| `--proxy <url>` | Proxy URL (`http://user:pass@host:port` or `socks5://...`) | — |
| `--verbose` | Include full metadata header in output | off |
| `--concurrency <n>` | Max concurrent batch requests | `8` |
| `--output <dir>` | Write results to files instead of stdout | — |
| `--no-progress` | Disable batch progress display (stderr) | off |

## Output formats

| Format | What you get |
|---|---|
| `markdown` | Clean, readable content with formatting preserved |
| `html` | Cleaned HTML output (stripped nav, sidebars, etc.) |
| `text` | Plain text with all formatting stripped |
| `json` | Structured JSON for API endpoints and metadata-heavy workflows |
| `raw` | Full raw server response (HTML/JSON/markdown/etc.) without extraction or truncation — for further parsing |

## How it works

`@thinkscape/smart-fetch` combines two technologies:

1. **[wreq-js](https://github.com/Thinkscape/wreq-js)** — makes HTTP requests with real browser TLS fingerprints, bypassing bot detection that blocks simple `curl` or `fetch` calls.
2. **[Defuddle](https://github.com/Thinkscape/defuddle)** — extracts clean, readable content from web pages, stripping navigation, ads, and clutter.

## Related packages

- [`pi-smart-fetch`](https://www.npmjs.com/package/pi-smart-fetch) — pi.dev agent extension
- [`openclaw-smart-fetch`](https://www.npmjs.com/package/openclaw-smart-fetch) — OpenClaw plugin

## License

MIT
