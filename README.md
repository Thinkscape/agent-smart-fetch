# Agent Smart Fetch

## Overview

Better web fetching for agents.

### [Smart Fetch for pi.dev](./packages/pi-smart-fetch/README.md) — pi.dev extension package, registers `web_fetch`
### [Smart Fetch for OpenClaw](./packages/openclaw-smart-fetch/README.md) — OpenClaw plugin package, registers `smart_fetch`

## Why use Smart Fetch?

### 1. `wreq-js` improves fetching on bot-defended sites

This repo uses `wreq-js` for network requests instead of relying on a naive Node.js HTTP stack.

Practical benefits:
- **Browser-like TLS fingerprinting** — request handshakes look much closer to real browsers, which matters on sites that inspect TLS fingerprints.
- **HTTP/2/browser impersonation** — helps avoid the classic mismatch where headers claim “Chrome” but the transport layer clearly does not.
- **Better success rate on anti-bot protected pages** — especially where simple `fetch()` requests are challenged, blocked, or silently degraded.
- **Lower overhead than full browser automation** — useful for readable-page fetching when you do not actually need JS execution, clicks, or logins.
- **Configurable browser/OS profiles** — useful when a specific fingerprint works better against a target site.

In short: it targets the class of failures where standard HTTP clients get flagged before content extraction even begins.

### 2. `Defuddle` turns messy pages into AI-friendly readable content

This repo uses `Defuddle` after fetching the raw page.

Practical benefits:
- **Extracts the main article/page content** instead of returning the full noisy DOM.
- **Removes clutter** like sidebars, nav, headers, footers, and other irrelevant chrome.
- **Produces cleaner markdown/text/html** for downstream agent consumption.
- **Preserves useful metadata** such as title, author, published date, site, and language when available.
- **Reduces token waste** by giving agents the readable content instead of the entire page shell.

In short: it optimizes fetched pages for analysis, summarization, RAG ingestion, and agent workflows.

### 3. One shared core, multiple harness adapters

This repo is built around a shared core with harness-specific adapters.

Benefits:
- **Consistent behavior across harnesses**
- **Harness-appropriate tool names**
  - pi → `web_fetch`
  - OpenClaw → `smart_fetch`
- **Shared tests and fetch/extraction logic** without duplicating implementation
- **Future harness support** can be added without rewriting the core pipeline

## Monorepo commands

Install everything:

```bash
bun install
```

Run everything:

```bash
bun run test
bun run build
bun run check
```

Run per package:

```bash
bun run test:core
bun run test:pi
bun run test:openclaw

bun run build:core
bun run build:pi
bun run build:openclaw
```

Integration tests:

```bash
bun run test:integration
```

Install local git hooks:

```bash
bun run hooks:install
```

## Versioning and publishing

Versioning is global across the monorepo.

Bump all package versions together:

```bash
bun run version:patch
bun run version:minor
bun run version:major
```

Create a release commit and tag:

```bash
bun run release
```

Manual local publish with your npm login:

```bash
bun run publish:pi
bun run publish:openclaw
```

Publish both published packages:

```bash
bun run publish:all
```

## Repository

- GitHub: `https://github.com/Thinkscape/agent-smart-fetch`
