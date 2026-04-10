# pi-smart-fetch

`pi-smart-fetch` adds a smarter `web_fetch` tool to pi.dev.

## Features

Compared with naive Node.js `fetch()`, this package gives you:
- **browser-like transport fingerprints** via `wreq-js`, which helps on sites that inspect TLS and HTTP client behavior
- **clean readable extraction** via `Defuddle`, so agents get article content instead of raw noisy HTML
- **better success on bot-defended pages** where plain server-side requests are blocked, challenged, or degraded
- **useful metadata** like title, author, published date, site, and language when available
- **multiple output formats**: `markdown`, `html`, `text`, or `json`
- **the familiar pi tool name**: it registers `web_fetch`
- **pi-specific behavior** including an optional `verbose` flag and defaults from pi settings
- **lower overhead than browser automation** when you do not need JS execution, login, scrolling, or clicks
- **clear limits**: it does not execute JavaScript or solve interactive anti-bot flows

## Install

From npm:

```bash
pi install npm:pi-smart-fetch
```

From a local checkout:

```bash
gh repo clone Thinkscape/agent-smart-fetch
pi install agent-smart-fetch/packages/pi-smart-fetch
```

## Use cases

Use `web_fetch` when you want to:
- fetch articles, docs, and blog posts with a browser-like network fingerprint
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

Set `verbose: true` to include fuller metadata such as:
- site
- language
- word count
- browser profile info

## Example tool outputs

### Compact output (default)

```text
> URL: https://example.com/blog/some-article
> Title: Some Article
> Author: Jane Doe
> Published: 2026-03-12

# Some Article

This is the cleaned readable content extracted from the page.
It omits most navigation, footer, and unrelated chrome.
```

### Verbose output (`verbose: true`)

```text
> URL: https://example.com/blog/some-article
> Title: Some Article
> Author: Jane Doe
> Published: 2026-03-12
> Site: Example Blog
> Language: en
> Words: 1284
> Browser: chrome_145/windows

# Some Article

This is the cleaned readable content extracted from the page.
It includes the same body content, but with a richer metadata header.
```

### Error output

```text
Error: Invalid URL: not-a-url
```

## Parameters

| Parameter         | Type                          | Default         | Description                                                                  |
|-------------------|-------------------------------|-----------------|------------------------------------------------------------------------------|
| `url`             | string                        | required        | URL to fetch                                                                 |
| `browser`         | string                        | `chrome_145`    | Browser profile used for transport fingerprinting                            |
| `os`              | string                        | `windows`       | OS profile: `windows`, `macos`, `linux`, `android`, `ios`                   |
| `headers`         | object                        | auto            | Extra request headers                                                        |
| `maxChars`        | number                        | `50000`         | Maximum returned characters. Can be overridden by pi settings                |
| `format`          | `markdown` \| `html` \| `text` \| `json` | `markdown`      | Output format                                                                |
| `removeImages`    | boolean                       | `false`         | Strip image references from output                                           |
| `includeReplies`  | boolean \| `extractors`       | `extractors`    | Include replies/comments                                                     |
| `proxy`           | string                        | none            | Proxy URL                                                                    |
| `verbose`         | boolean                       | `false`         | Include the full metadata header. Can default from `smartFetchVerboseByDefault` |

## pi settings

Optional custom settings in `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "smartFetchVerboseByDefault": false,
  "smartFetchDefaultMaxChars": 12000,
  "smartFetchDefaultTimeoutMs": 15000,
  "smartFetchDefaultBrowser": "chrome_145",
  "smartFetchDefaultOs": "windows",
  "smartFetchDefaultRemoveImages": false,
  "smartFetchDefaultIncludeReplies": "extractors"
}
```

Behavior:
- `smartFetchVerboseByDefault` sets the default for `verbose`
- `smartFetchDefaultMaxChars` sets the runtime default for `maxChars`
- `smartFetchDefaultTimeoutMs` sets the runtime request timeout
- `smartFetchDefaultBrowser` sets the default browser fingerprint profile
- `smartFetchDefaultOs` sets the default OS fingerprint profile
- `smartFetchDefaultRemoveImages` sets the default for image stripping
- `smartFetchDefaultIncludeReplies` sets the default replies/comments behavior
- project `.pi/settings.json` overrides global `~/.pi/agent/settings.json`

## When not to use it

Do not use this tool when:
- the site requires JS rendering
- you need login/session flows
- you need to click, scroll, or submit forms
- you need a fully interactive browser session

In those cases, switch to browser automation.
