# agent-smart-fetch

A Bun monorepo for smart web fetching across multiple agent harnesses.

## Start here

This root README is intentionally just a signpost.

Published packages:
- [`pi-smart-fetch`](./packages/pi-smart-fetch/README.md) — pi.dev extension package, registers `web_fetch`
- [`openclaw-smart-fetch`](./packages/openclaw-smart-fetch/README.md) — OpenClaw plugin package, registers `defuddle_fetch`

Internal package:
- `packages/core` — shared fetch/extract core used by both published packages; not published to npm

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
