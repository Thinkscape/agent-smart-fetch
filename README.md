# agent-defuddle-fetch

An OpenClaw plugin that provides `defuddle_fetch`: browser-fingerprinted HTTP fetching via `wreq-js`, followed by clean article extraction via `Defuddle`.

## Why this plugin exists

Some sites block generic fetch clients because their TLS and HTTP/2 fingerprints do not look like a real browser. This plugin uses `wreq-js` to impersonate real browsers at the transport layer, then uses `Defuddle` to turn the fetched HTML into readable content with metadata.

Use it when:
- `web_fetch` gets blocked or returns poor content
- you want cleaner article extraction
- you need author/publish/site metadata

Do **not** use it when:
- the page requires JavaScript execution
- you need login/session interaction
- you need to click, scroll, or submit forms

In those cases, use a browser automation tool instead.

## Features

- Browser-grade TLS/HTTP2 fingerprinting via `wreq-js`
- Clean extraction via `Defuddle`
- Markdown, HTML, and plain-text output modes
- Structured metadata in the tool response
- Configurable browser profile, OS profile, proxy, reply extraction, and truncation
- Strong TypeScript typings
- Unit, contract, and live integration tests

## Install

### Local development

```bash
openclaw plugins install -l ./projects/agent-defuddle-fetch
```

### From npm

Once published:

```bash
openclaw plugins install agent-defuddle-fetch
```

### From ClawHub

If published to ClawHub, OpenClaw can install it there too:

```bash
openclaw plugins install clawhub:agent-defuddle-fetch
```

OpenClaw tries ClawHub first and falls back to npm for bare package specs.

## Usage

```txt
defuddle_fetch({ url: "https://example.com/article" })
```

### Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `url` | string | required | URL to fetch |
| `browser` | string | `chrome_145` | Browser profile for TLS fingerprinting |
| `os` | string | `windows` | OS profile: `windows`, `macos`, `linux`, `android`, `ios` |
| `headers` | object | auto | Extra request headers |
| `maxChars` | number | `50000` | Maximum returned characters |
| `format` | `markdown` \| `html` \| `text` | `markdown` | Output format |
| `removeImages` | boolean | `false` | Strip image references |
| `includeReplies` | boolean \| `extractors` | `extractors` | Include replies/comments |
| `proxy` | string | none | Proxy URL |

## OpenClaw configuration

Optional plugin config in your OpenClaw config:

```json5
{
  plugins: {
    entries: {
      "defuddle-fetch": {
        enabled: true,
        config: {
          browser: "chrome_145",
          os: "windows",
          maxChars: 50000,
          timeoutMs: 15000,
          removeImages: false,
          includeReplies: "extractors"
        }
      }
    }
  }
}
```

## Development

### Requirements

- Bun `>= 1.3`
- Node `>= 22`

### Scripts

```bash
bun run format         # format code
bun run format:check   # verify formatting
bun run lint           # biome + TypeScript
bun run test           # unit + contract tests
bun run test:integration
bun run coverage       # unit/contract coverage with lcov output
bun run build          # emit dist/*.js and dist/*.d.ts
bun run pack:dry-run   # verify published package contents
bun run check          # lint + test + build
```

### Test suite

- `test/unit/*` - fast pure unit tests
- `test/contract/*` - tool registration/schema contract tests
- `test/integration/*` - live network tests against real websites

Integration tests are intentionally isolated behind `bun run test:integration`.

## Publishing

This package is structured for npm publishing and OpenClaw installation.

### npm publish

```bash
bun install
bun run check
bun run pack:dry-run
npm login
npm publish --access public
```

### GitHub Actions publish flow

A tag-based workflow is included using npm Trusted Publishing:
- configure npm Trusted Publishing for this GitHub repository/workflow
- push a tag like `v0.1.1`
- GitHub Actions verifies the package and publishes to npm via OIDC
- the workflow uses Node 24 and npm `11.5.1+`, which npm Trusted Publishing requires

No long-lived `NPM_TOKEN` secret is required.

### ClawHub

OpenClaw supports plugin distribution through ClawHub as well. For external plugins, OpenClaw docs indicate ClawHub publishing support via `clawhub package publish ...`, and bare plugin installs try ClawHub before npm.

## Project layout

```txt
index.ts                 # plugin entry
src/constants.ts         # shared defaults
src/dependencies.ts      # runtime dependency wiring
src/dom.ts               # linkedom compatibility helpers
src/extract.ts           # core fetch/extract pipeline
src/format.ts            # metadata and text formatting helpers
src/profiles.ts          # browser profile helpers
src/types.ts             # shared types
test/unit/               # unit tests
test/contract/           # contract tests
test/integration/        # live integration tests
dist/                    # build output
```

## Credits

- [`wreq-js`](https://wreq.sqdsh.win/) - browser-grade TLS fingerprinting
- [`Defuddle`](https://github.com/kepano/defuddle) - readable content extraction
- Built for [OpenClaw](https://github.com/openclaw/openclaw)
