# Agent Smart Fetch

Better web fetching for agents.

## [Smart Fetch for pi.dev](./packages/pi-smart-fetch/README.md)

Registers `web_fetch` and `batch_web_fetch` tools.

## [Smart Fetch for OpenClaw](./packages/openclaw-smart-fetch/README.md)

OpenClaw plugin, registers `smart_fetch` and `batch_smart_fetch` alongside the built-in `web_fetch` tool.

![pi Smart Fetch](packages/pi-smart-fetch/demo.gif)

## Features

- **browser-like transport fingerprints** via Thinkscape's maintained `@thinkscape/wreq-js` fork, which helps on sites that inspect TLS and HTTP client behavior
- **clean readable extraction** via `Defuddle`, so agents get article content instead of raw noisy HTML
- **better success on bot-defended pages** where plain server-side requests are blocked, challenged, or degraded
- **useful metadata** like title, author, published date, site, and language when available
- **multiple output formats**: `markdown`, `html`, `text`, or `json`
- **single and batch tools**: `web_fetch` for one URL, `batch_web_fetch` for many
- **bounded batch fan-out** with a configurable default concurrency of `8`
- **request-phase progress support** wired through the core so richer transport events from the Thinkscape `wreq-js` fork can feed weighted progress updates
- **animated pi batch progress** with timer-driven spinner refreshes and weighted per-item progress
- **attachment and binary download support** for `Content-Disposition: attachment` and non-text content types, streamed into temp files instead of being forced through Defuddle
- **sanitized temp-file naming** derived from `Content-Disposition`, URL path segments, or UUID fallback, with deburring and extension normalization
- **consumer-provided temp directories** so pi/OpenClaw can control where downloaded files land
- **pi-specific behavior** including an optional `verbose` flag, richer TUI rendering, and defaults from pi settings
- **publish-ready workspace tooling** with broader unit coverage, typechecking, build checks, and pack-install smoke tests
- **lower overhead than browser automation** when you do not need JS execution, login, scrolling, or clicks
- **clear limits**: it does not execute JavaScript or solve interactive anti-bot flows

## Recent feature additions

Recent `feat:` work in this repo added:
- **attachment + binary streaming** via temp files with file metadata returned to the caller
- **animated batch spinner updates in the pi TUI** so long-running batches continue to feel alive
- **publish-ready TypeScript/tooling/test infrastructure** across the monorepo


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

Install the local pre-commit hook:

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
