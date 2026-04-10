# pi-smart-fetch

`pi-smart-fetch` adds a smarter `web_fetch` tool to pi.dev by combining:
- `wreq-js` for browser-like transport fingerprints
- `Defuddle` for readable content extraction

It is designed for pages where a naive Node.js `fetch()` often gets blocked, challenged, or returns HTML that is technically valid but poor for agent consumption.

## What problem it solves

Compared to a naive `fetch()` approach in Node.js:
- it is **harder to detect as a non-browser client** because the TLS/HTTP layer looks more like a real browser
- it is **better at surviving anti-bot checks** that inspect transport fingerprints instead of only headers
- it returns **clean extracted content** instead of raw page markup
- it gives agents **useful metadata** and less noise

This package is a good fit when you want lightweight readable-page retrieval without stepping up to full browser automation.

## Bot-detection focus

This tool specifically helps with sites that look at:
- TLS/client fingerprints
- browser-vs-header consistency
- suspicious non-browser transport behavior

It does **not** execute JavaScript, solve interactive challenges, log in, click buttons, or scroll pages.

If the site needs real browser execution, use browser automation instead.

## What tool it exposes

This package registers:
- `web_fetch`

## Install

From npm:

```bash
pi install npm:pi-smart-fetch
```

From a local checkout:

```bash
pi install /absolute/path/to/agent-smart-fetch/packages/pi-smart-fetch
```

## Use cases

Use `web_fetch` when you want to:
- fetch articles/docs/blog posts with a browser-like network fingerprint
- analyze readable content instead of raw HTML
- reduce agent token waste on noisy page chrome
- get author/title/published metadata when available
- work around pages that reject ordinary server-side fetches

## Output behavior

By default, the tool returns a compact response containing non-empty:
- URL
- Title
- Author
- Published
- content

Set `verbose: true` to include fuller metadata such as site, language, word count, and browser profile info.

## Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `url` | string | required | URL to fetch |
| `browser` | string | `chrome_145` | Browser profile used for transport fingerprinting |
| `os` | string | `windows` | OS profile: `windows`, `macos`, `linux`, `android`, `ios` |
| `headers` | object | auto | Extra request headers |
| `maxChars` | number | `50000` | Maximum returned characters |
| `format` | `markdown` \| `html` \| `text` | `markdown` | Output format |
| `removeImages` | boolean | `false` | Strip image references from output |
| `includeReplies` | boolean \| `extractors` | `extractors` | Include replies/comments |
| `proxy` | string | none | Proxy URL |
| `verbose` | boolean | `false` | Include the full metadata header |

## pi settings

Optional custom settings in `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "webFetchVerboseByDefault": false,
  "webFetchDefaultMaxChars": 12000
}
```

Behavior:
- `webFetchVerboseByDefault` sets the default for `verbose`
- `webFetchDefaultMaxChars` sets the default for `maxChars`
- project `.pi/settings.json` overrides global `~/.pi/agent/settings.json`

## When not to use it

Do not use this tool when:
- the site requires JS rendering
- you need login/session flows
- you need to click, scroll, or submit forms
- you need a fully interactive browser session

In those cases, switch to browser automation.
