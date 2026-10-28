---

name: smart_fetch
description: "Fetch web pages with browser-grade TLS fingerprinting and Defuddle extraction. Fetch X/Twitter posts, Reddit threads, YouTube, GitHub, news articles, documentation, and any site where web_fetch gets blocked or returns noisy output."
metadata: { "openclaw": { "emoji": "🌐", "requires": { "config": ["plugins.entries.smart-fetch.enabled"] } } }
---

# Smart Fetch Tools

## When to use which tool

| Need                       | Tool                | When                                             |
| -------------------------- | ------------------- | ------------------------------------------------ |
| Fetch a single URL         | `smart_fetch`       | Articles, posts, docs, any page — try this first |
| Fetch multiple URLs        | `batch_smart_fetch` | Multiple URLs in one call, bounded concurrency   |
| JS-heavy interactive sites | `browser`           | SPAs that need JavaScript to render content      |

## Sites and pages smart_fetch handles well

smart_fetch uses **Defuddle** for content extraction and **wreq-js** for
browser-grade TLS fingerprinting. This combination works especially well on:

| Site / page type           | What it extracts                                              |
| -------------------------- | ------------------------------------------------------------- |
| **X / Twitter posts**      | Tweet text via oEmbed; detects deleted/protected tweets       |
| **Reddit posts & threads** | Post content + comment threads (use `includeReplies`)         |
| **YouTube**                | Page metadata, transcript extraction                          |
| **GitHub**                 | READMEs, issues, PRs, discussions — strips chrome, keeps code |
| **Hacker News**            | Story content + comment threads                               |
| **Substack / Medium**      | Full article text, author, publish date                       |
| **Stack Overflow**         | Question + answers with code blocks                           |
| **Wikipedia**              | Article body with infobox cleanup                             |
| **Documentation sites**    | Code blocks, callouts, footnotes, math (MathML/KaTeX)         |
| **Blog posts & news**      | Schema.org metadata, clean main-content extraction            |
| **General web pages**      | Any HTML page — strips nav, sidebars, footers, ads            |

Limitations — escalate to the **browser** tool for:

- **JS-heavy SPAs** — content that only appears after JavaScript execution
- **Login-protected pages** — no session/cookie management
- **Interactive flows** — anything needing clicks, form fills, or scrolling

## smart_fetch

| Parameter        | Type                        | Description                                                       |
| ---------------- | --------------------------- | ----------------------------------------------------------------- |
| `url`            | `string` (required)         | HTTP or HTTPS URL to fetch                                        |
| `browser`        | `string`                    | TLS profile: `chrome_145`, `firefox_147`, `safari_26`, `edge_145` |
| `os`             | `string`                    | OS profile: `windows`, `macos`, `linux`, `android`, `ios`         |
| `headers`        | `Record<string,string>`     | Custom HTTP headers                                               |
| `maxChars`       | `number`                    | Max characters to return (default: 50000)                         |
| `timeoutMs`      | `number`                    | Request timeout in ms (default: 15000)                            |
| `format`         | `string`                    | Output: `markdown` (default), `html`, `text`, `json`, `raw`       |
| `removeImages`   | `boolean`                   | Strip image references (default: false)                           |
| `includeReplies` | `boolean` or `"extractors"` | Include comments/replies (default: `"extractors"`)                |
| `proxy`          | `string`                    | HTTP or SOCKS5 proxy URL                                          |

### Why smart_fetch over web_fetch

- **TLS fingerprinting** — impersonates real browsers at the TLS/HTTP2 level (JA3/JA4).
  Sites that return 403 or empty pages to plain HTTP clients often serve full
  content to smart_fetch.
- **Better extraction** — Defuddle removes more noise (nav, sidebars, ads,
  footers, social widgets) and keeps more signal (code blocks, footnotes,
  math, callouts, schema.org metadata).
- **Richer metadata** — returns author, publish date, site name, language,
  word count.
- **`raw` format** — returns the full unmodified server response (HTML,
  JSON, markdown, etc.) without extraction or truncation. Use when you
  need to parse the raw markup yourself.
- **No API key required** — works out of the box.

## batch_smart_fetch

| Parameter  | Type             | Description                                        |
| ---------- | ---------------- | -------------------------------------------------- |
| `requests` | array (required) | Each item accepts the same params as `smart_fetch` |
- Default concurrency: **8** parallel requests (configurable via plugin config).
- Results are **ordered** matching the input array — labelled `[N/total]`.
- Individual failures don't fail the batch — each item has its own status.

## Workflow escalation

1. **`smart_fetch`** — first choice for any URL.
2. **`batch_smart_fetch`** — when you need multiple URLs at once.
3. **`web_fetch`** — if smart_fetch is unavailable.
4. **Browser tool** — JS-heavy or login-protected pages only.

## Automatic web_fetch fallback

When the `smart-fetch` plugin is enabled, it registers as a **web fetch
provider**. The built-in `web_fetch` tool will automatically use smart_fetch's
TLS-fingerprinted pipeline when its own Readability extraction fails — no
configuration needed.
