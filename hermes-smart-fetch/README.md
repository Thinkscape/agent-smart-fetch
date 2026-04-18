# hermes-smart-fetch

A [Hermes Agent](https://github.com/NousResearch/hermes-agent) plugin that provides **real browser TLS fingerprinting** via [curl-impersonate](https://github.com/lexiforest/curl-impersonate) with [Defuddle](https://github.com/nicepkg/defuddle) article extraction.

## What it does

- **`web_fetch`** — Fetch a single URL with real TLS/JA3/JA4 + HTTP/2 fingerprinting that matches actual desktop browsers at the cryptographic level, then extract clean readable content via Defuddle.
- **`batch_web_fetch`** — Fetch multiple URLs concurrently (up to 10) with the same capabilities.

### How it's different from setting a User-Agent

This is **not** User-Agent spoofing. The plugin uses [curl_cffi](https://github.com/lexiforest/curl_cffi) (Python bindings for curl-impersonate), which patches curl's TLS stack (BoringSSL) to replicate the exact:

| Layer | What's replicated |
|-------|-------------------|
| **TLS** | Cipher suites, extensions, supported groups, ALPN, GREASE, key share order → identical JA3/JA4 hash |
| **HTTP/2** | SETTINGS frame, WINDOW_UPDATE, PRIORITY frames → identical Akamai fingerprint |
| **Headers** | Exact header casing and ordering per browser |
| **HTTP/3** | QUIC transport params + HTTP/3 settings (curl_cffi v0.15+) |

### Supported browser profiles

| Browser | Desktop versions |
|---------|-----------------|
| **Chrome** | chrome99 → chrome146 (16 versions) + alias `chrome` (latest) |
| **Firefox** | firefox133, firefox135, firefox144, firefox147 + alias `firefox` |
| **Safari** | safari153 → safari2601 (8 versions) + alias `safari` |
| **Edge** | edge99, edge101 + alias `edge` |
| **Tor** | tor145 |
| Mobile | chrome_android, safari_ios |

## Installation

### Option 1: pip install (recommended)

```bash
pip install hermes-smart-fetch
```

The plugin is auto-discovered by Hermes on next startup via the `hermes_agent.plugins` entry point.

### Option 2: Manual directory plugin

Clone this repo and symlink or copy it into your plugins directory:

```bash
git clone <this-repo> /tmp/hermes-smart-fetch
ln -s /tmp/hermes-smart-fetch ~/.hermes/plugins/smart-fetch
```

## Usage

After installation, start Hermes normally:

```bash
hermes
```

You should see `smart-fetch: web_fetch, batch_web_fetch` in the startup banner.

### Example prompts

```
Fetch https://example.com/article and summarize it
Read the content of https://docs.python.org/3/whatsnew/3.13.html
Fetch https://cloudflare-protected-site.com/page
Fetch these 3 URLs and compare them: https://...
```

### Bundled skill

The plugin ships a `smart-fetch` skill that teaches the agent how to use the tools effectively. Access it via:

```
skill_view("smart-fetch:smart-fetch")
```

## Dependencies

- `curl_cffi>=0.15.0` — Python binding for curl-impersonate (real TLS/JA3/HTTP2 fingerprinting)
- `defuddle>=0.1.0` — Article/content extraction from HTML

## License

MIT
