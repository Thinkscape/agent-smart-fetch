# openclaw-smart-fetch

`openclaw-smart-fetch` adds smarter web fetching tools to [OpenClaw](https://github.com/nicepkg/openclaw).

## Features

- 🔐 **Browser-like TLS/SSL + HTTP fingerprints** — better success on bot-defended pages
- 🧹 **Defuddle extraction** — clean readable content instead of noisy HTML
- 🧠 **Useful metadata** — title, author, site, language, published date when available
- 📦 **Downloads + large file support** — stream attachments and binaries to temp files
- 🔁 **Client-side `<meta>` redirects** — follows sane meta refresh redirects with loop limits
- 🔗 **Alternate content fallback** — when extraction produces no/thin content, follows qualified `<link rel="alternate" type="...">` entries in `<head>` that match the requested output format
- ⚡ **Batch fetch** — fetch many URLs with bounded concurrency
- 📝 **Multiple output formats** — `markdown`, `html`, `text`, `json`, `raw`
- 🔄 **Built-in `web_fetch` fallback** — automatically improves the core web_fetch tool
- 📖 **Bundled skill** — agents get usage guidance injected into their system prompt

## Site optimisations

This package works on general web pages, but some site types benefit especially
from Defuddle's extractors and cleanup:

| Site / page type | What's improved |
|---|---|
| **X / Twitter posts** | oEmbed-based tweet extraction; deleted/protected tweet detection |
| **Reddit posts & threads** | Comment thread extraction with `includeReplies` |
| **YouTube** | Page metadata and transcript extraction |
| **GitHub** | READMEs, issues, PRs, discussions — strips chrome, keeps code blocks |
| **Hacker News** | Thread extraction with comment cleanup |
| **Substack / Medium** | Article content with author, publish date, paywall bypass on open pages |
| **Stack Overflow** | Q&A extraction with code blocks and accepted answers |
| **Wikipedia** | Article content with infobox cleanup |
| **Documentation sites** | Keeps code blocks, callouts, footnotes, math (MathML/KaTeX/MathJax) |
| **Blog posts & articles** | Schema.org metadata, clean main-content extraction |

Notes:
- Defuddle is the cleanup layer: it strips common page chrome like nav, sidebars, related links, share widgets, and footers
- It does **not** execute JavaScript or solve interactive anti-bot/login flows
- If an HTML shell advertises alternate content in `<head>`, smart-fetch can follow matching alternates such as `text/markdown`, `text/plain`, `text/html`, or JSON media types according to the requested `format`

## Install

From npm:

```bash
openclaw plugins install openclaw-smart-fetch
```

From a local checkout:

```bash
openclaw plugins install -l /absolute/path/to/agent-smart-fetch/packages/openclaw-smart-fetch
```

## OpenClaw tools

Registers:

- `smart_fetch` — single URL fetch with TLS fingerprinting and Defuddle extraction
- `batch_smart_fetch` — multiple URLs with bounded concurrency and per-item results

Synopsis:

```text
smart_fetch(url, browser?, os?, headers?, maxChars?, maxResponseBytes?, timeoutMs?, format?, removeImages?, includeReplies?, proxy?)
batch_smart_fetch(requests)
```

For `batch_smart_fetch`, each item in `requests` accepts the same parameters as `smart_fetch`.

## Built-in `web_fetch` fallback provider

When this plugin is installed and enabled, it **automatically registers as a
WebFetch provider** for OpenClaw's built-in `web_fetch` tool. No extra
configuration needed.

### How it works

When `web_fetch`'s built-in HTTP + Readability extraction fails (e.g. the page
blocks plain HTTP clients or Readability can't find content), OpenClaw calls
the smart_fetch provider as a fallback. The provider runs the full
TLS-fingerprinted + Defuddle pipeline and returns clean content.

This means you get smart_fetch's better extraction on bot-protected sites
_without replacing `web_fetch` or changing any agent prompts_.

### Provider priority

| Provider        | `autoDetectOrder`   | Credential required |
|-----------------|:-------------------:|:-------------------|
| **smart-fetch** | **10** (highest)    | No                 |
| firecrawl       | 50                  | Yes (API key)      |

Because `smart-fetch` has the highest priority and requires no credentials, it
is selected first during auto-detection. If the smart_fetch provider itself
fails (e.g. the page needs full browser automation), OpenClaw falls through to
the next configured provider.

### Explicit provider selection

You can force the built-in `web_fetch` to use smart_fetch when it needs a fallback:

```json5
{
  "tools": {
    "web": {
      "fetch": {
        "provider": "smart-fetch"
      }
    }
  }
}
```

Note: setting `provider` only affects which provider is selected as the fallback —
the built-in HTTP fetch still runs first. The provider is only called when
Readability extraction fails (or when `readability: false` is set for HTML
responses). The provider then re-fetches the URL with its own TLS-fingerprinted
client, so there is a double-fetch cost when the fallback kicks in.

## Bundled skill

The plugin ships a skill (`smart-fetch`) that OpenClaw injects into agent
system prompts when the plugin is enabled. The skill documents:

- When to prefer `smart_fetch` over `web_fetch` or the browser tool
- Parameter reference for both tools
- Workflow escalation pattern (smart_fetch → batch → web_fetch → browser)
- The automatic fallback behavior

Skills are declared in the manifest (`openclaw.plugin.json`) under `"skills":
["./skills"]` and loaded from `skills/smart-fetch/SKILL.md`.

## Output formats

| Format | What you get |
|---|---|
| `markdown` | Best default for readable page content |
| `html` | Cleaned HTML output |
| `text` | Plain text with markdown stripped |
| `json` | Structured JSON for metadata-heavy workflows |
| `raw` | Full raw server response without extraction or truncation — for further parsing |

## Plugin config

See `openclaw.plugin.json` for the full schema. Configure under
`plugins.entries.smart-fetch.config`:

```json5
{
  "plugins": {
    "entries": {
      "smart-fetch": {
        "enabled": true,
        "config": {
          "maxChars": 50000,
          "maxResponseBytes": 1048576,
          "timeoutMs": 15000,
          "browser": "chrome_145",
          "os": "windows",
          "removeImages": false,
          "includeReplies": "extractors",
          "batchConcurrency": 8
        }
      }
    }
  }
}
```

| Setting | Default | Description |
|---|---:|---|
| `maxChars` | `50000` | Default maximum returned characters |
| `maxResponseBytes` | `1048576` | Default maximum bytes of a text response to read; longer pages are cut before extraction and get a `Truncated:` metadata line |
| `timeoutMs` | `15000` | Default request timeout in milliseconds; content extraction gets the same budget |
| `browser` | `chrome_145` | Default browser fingerprint profile |
| `os` | `windows` | Default OS fingerprint profile |
| `removeImages` | `false` | Strip image references by default |
| `includeReplies` | `extractors` | Include replies/comments only when site extractors support them |
| `batchConcurrency` | `8` | Default bounded concurrency for `batch_smart_fetch` |
| `tempDir` | OS temp dir | Directory for attachment and binary downloads |

## Dev and publishing note

This repo uses Bun for local development, tests, and workspace scripts. Package
publishing still goes through `npm publish` in CI so npm Trusted Publishing can
be used.
