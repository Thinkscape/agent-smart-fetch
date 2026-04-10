# openclaw-smart-fetch

`openclaw-smart-fetch` adds smarter fetching tools for OpenClaw.

It registers:
- `smart_fetch`
- `batch_smart_fetch`

It combines:
- `wreq-js` for browser-like transport fingerprints
- `Defuddle` for readable content extraction

## Why use this instead of OpenClaw's built-in `web_fetch`

Use this package when the built-in `web_fetch` is not enough.

Typical advantages:
- **better resistance to bot detection** on sites that inspect TLS/HTTP client fingerprints
- **more browser-like transport behavior** instead of a generic server-side HTTP client
- **cleaner extracted content** instead of raw or noisy page output
- **better article/document readability** for downstream agent analysis
- **useful metadata** like title, author, published date, site, and language when available
- **batch fan-out support** when you want to fetch multiple URLs in one tool call

A good rule of thumb:
- use built-in `web_fetch` for simple pages
- use `smart_fetch` when pages are blocked, noisy, or extraction quality matters
- use `batch_smart_fetch` when you need the same smarter fetch behavior over many URLs at once

## Bot-detection focus

These tools are aimed at sites that detect bots through:
- TLS/client fingerprinting
- transport/header inconsistencies
- non-browser HTTP behavior

They do **not** execute JavaScript or solve interactive anti-bot flows.

If a page requires JS execution, login, scrolling, or clicking, use browser automation instead.

## What tools it exposes

This package registers:
- `smart_fetch`
- `batch_smart_fetch`

OpenClaw keeps separate tool names because overriding/hoisting built-in `web_fetch` is not the desired path here.

## Install

From npm:

```bash
openclaw plugins install openclaw-smart-fetch
```

From a local checkout:

```bash
openclaw plugins install -l /absolute/path/to/agent-smart-fetch/packages/openclaw-smart-fetch
```

## Use cases

Use `smart_fetch` when you want to:
- fetch pages that reject naive HTTP clients
- extract the readable body from articles, docs, and blog posts
- reduce noise before passing content to an agent
- preserve page metadata for summarization or research
- use browser-like fetching without paying the cost of full browser automation

Use `batch_smart_fetch` when you want to:
- fetch multiple URLs in one tool call
- preserve a clear mapping between each input URL and its result
- keep full content for successes while retaining per-item error strings for failures
- run bounded-concurrency fetches instead of firing everything at once

## Tool synopsis

```text
smart_fetch(url, browser?, os?, headers?, maxChars?, format?, removeImages?, includeReplies?, proxy?)
batch_smart_fetch(requests)
```

For `batch_smart_fetch`, `requests` is an array of objects, and **each item accepts the same parameters as `smart_fetch`**.

## Example output

### `smart_fetch`

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
```

### `batch_smart_fetch`

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
> Site: Example Blog
> Language: en
> Words: 1284
> Browser: chrome_145/windows

# Some Article

This is the cleaned readable content extracted from the page.

## [2/2] https://blocked.example/post
> URL: https://blocked.example/post
> Status: error
> Error: HTTP 403 Forbidden for https://blocked.example/post
```

## Parameters

### `smart_fetch`

| Parameter         | Type                          | Default         | Description                                               |
|-------------------|-------------------------------|-----------------|-----------------------------------------------------------|
| `url`             | string                        | required        | URL to fetch                                              |
| `browser`         | string                        | `chrome_145`    | Browser profile used for transport fingerprinting         |
| `os`              | string                        | `windows`       | OS profile: `windows`, `macos`, `linux`, `android`, `ios` |
| `headers`         | object                        | auto            | Extra request headers                                     |
| `maxChars`        | number                        | `50000`         | Maximum returned characters                               |
| `format`          | `markdown` \| `html` \| `text` \| `json` | `markdown`      | Output format                                             |
| `removeImages`    | boolean                       | `false`         | Strip image references from output                        |
| `includeReplies`  | boolean \| `extractors`       | `extractors`    | Include replies/comments                                  |
| `proxy`           | string                        | none            | Proxy URL                                                 |

### `batch_smart_fetch`

| Parameter   | Type             | Default   | Description |
|-------------|------------------|-----------|-------------|
| `requests`  | array of objects | required  | Array of fetch requests. Each item accepts the same parameters as `smart_fetch` |

## OpenClaw config

See `openclaw.plugin.json` for plugin config defaults and schema.

Configurable defaults include:
- `maxChars`
- `timeoutMs`
- `browser`
- `os`
- `removeImages`
- `includeReplies`
- `batchConcurrency`

`batchConcurrency` defaults to `8` and controls how many `batch_smart_fetch` requests run concurrently.

## When not to use it

Do not use these tools when:
- the page requires JS rendering
- you need login/session flows
- you need clicks, scrolling, or form submission
- a full browser session is required

In those cases, use browser automation instead.
