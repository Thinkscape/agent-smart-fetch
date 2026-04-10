# pi-smart-fetch

`pi-smart-fetch` adds smarter web fetching tools to pi.dev.

It registers:
- `web_fetch`
- `batch_web_fetch`

## Features

Compared with naive Node.js `fetch()`, this package gives you:
- **browser-like transport fingerprints** via `wreq-js`, which helps on sites that inspect TLS and HTTP client behavior
- **clean readable extraction** via `Defuddle`, so agents get article content instead of raw noisy HTML
- **better success on bot-defended pages** where plain server-side requests are blocked, challenged, or degraded
- **useful metadata** like title, author, published date, site, and language when available
- **multiple output formats**: `markdown`, `html`, `text`, or `json`
- **single and batch tools**: `web_fetch` for one URL, `batch_web_fetch` for many
- **pi-specific behavior** including an optional `verbose` flag and defaults from pi settings
- **bounded batch fan-out** with a configurable default concurrency of `8`
- **a richer pi TUI for batch mode** with per-item rows, truncated URLs, statuses, and small progress bars
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
- fetch one article, doc page, or blog post with a browser-like network fingerprint
- analyze readable content instead of raw HTML
- reduce agent token waste on noisy page chrome
- get author/title/published metadata when available
- work around pages that reject ordinary server-side fetches

Use `batch_web_fetch` when you want to:
- fetch multiple URLs in one tool call
- preserve a clear mapping between each input URL and its result
- let pi show per-item progress while the batch runs
- collect a mix of successes and failures without losing per-item errors

## Tool synopsis

```text
web_fetch(url, browser?, os?, headers?, maxChars?, format?, removeImages?, includeReplies?, proxy?, verbose?)
batch_web_fetch(requests, verbose?)
```

For `batch_web_fetch`, `requests` is an array of objects, and **each item accepts the same parameters as `web_fetch` except `verbose`**.

## Output behavior

### `web_fetch`

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

### `batch_web_fetch`

Batch output:
- starts with a batch summary (`Requests`, `Succeeded`, `Failed`, `Concurrency`)
- keeps results in input order
- labels each item with its ordinal and URL
- includes full content for successful items
- includes a bot-friendly `Error:` line for failed items

In the pi TUI, batch mode also streams per-item progress rows showing:
- a small spinner/check/error glyph
- a truncated URL
- a one-word status (`queued`, `fetching`, `extracting`, `done`, `error`)
- a small progress bar

## Example tool outputs

### Compact `web_fetch` output (default)

```text
> URL: https://example.com/blog/some-article
> Title: Some Article
> Author: Jane Doe
> Published: 2026-03-12

# Some Article

This is the cleaned readable content extracted from the page.
It omits most navigation, footer, and unrelated chrome.
```

### Verbose `web_fetch` output (`verbose: true`)

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

### `batch_web_fetch` output

```text
> Requests: 2
> Succeeded: 1
> Failed: 1
> Concurrency: 8

## [1/2] https://example.com/blog/some-article
> URL: https://example.com/blog/some-article
> Title: Some Article
> Author: Jane Doe
> Published: 2026-03-12

# Some Article

This is the cleaned readable content extracted from the page.

## [2/2] https://blocked.example/post
> URL: https://blocked.example/post
> Status: error
> Error: HTTP 403 Forbidden for https://blocked.example/post
```

### Error output

```text
Error: Invalid URL: not-a-url
```

## Parameters

### `web_fetch`

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

### `batch_web_fetch`

| Parameter   | Type                | Default   | Description |
|-------------|---------------------|-----------|-------------|
| `requests`  | array of objects    | required  | Array of fetch requests. Each item accepts the same parameters as `web_fetch` except `verbose` |
| `verbose`   | boolean             | `false`   | Include the full metadata header for each successful result |

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
  "smartFetchDefaultIncludeReplies": "extractors",
  "smartFetchDefaultBatchConcurrency": 8
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
- `smartFetchDefaultBatchConcurrency` sets the default bounded concurrency for `batch_web_fetch`
- project `.pi/settings.json` overrides global `~/.pi/agent/settings.json`

Legacy aliases still supported:
- `webFetchVerboseByDefault`
- `webFetchDefaultMaxChars`
- `webFetchDefaultBatchConcurrency`

## When not to use it

Do not use these tools when:
- the site requires JS rendering
- you need login/session flows
- you need to click, scroll, or submit forms
- you need a fully interactive browser session

In those cases, switch to browser automation.
