# openclaw-smart-fetch

`openclaw-smart-fetch` adds a smarter fetching plugin for OpenClaw by exposing `smart_fetch`.

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

A good rule of thumb:
- use built-in `web_fetch` for simple pages
- use `smart_fetch` when pages are blocked, noisy, or extraction quality matters

## Bot-detection focus

This tool is aimed at sites that detect bots through:
- TLS/client fingerprinting
- transport/header inconsistencies
- non-browser HTTP behavior

It does **not** execute JavaScript or solve interactive anti-bot flows.

If a page requires JS execution, login, scrolling, or clicking, use browser automation instead.

## What tool it exposes

This package registers:
- `smart_fetch`

OpenClaw keeps the separate tool name because overriding/hoisting built-in `web_fetch` is not the desired path here.

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

## Parameters

| Parameter         | Type                          | Default         | Description                                               |
|-------------------|-------------------------------|-----------------|-----------------------------------------------------------|
| `url`             | string                        | required        | URL to fetch                                              |
| `browser`         | string                        | `chrome_145`    | Browser profile used for transport fingerprinting         |
| `os`              | string                        | `windows`       | OS profile: `windows`, `macos`, `linux`, `android`, `ios` |
| `headers`         | object                        | auto            | Extra request headers                                     |
| `maxChars`        | number                        | `50000`         | Maximum returned characters                               |
| `format`          | `markdown` \| `html` \| `text`| `markdown`      | Output format                                             |
| `removeImages`    | boolean                       | `false`         | Strip image references from output                        |
| `includeReplies`  | boolean \| `extractors`       | `extractors`    | Include replies/comments                                  |
| `proxy`           | string                        | none            | Proxy URL                                                 |

## OpenClaw config

See `openclaw.plugin.json` for plugin config defaults and schema.

Configurable defaults include:
- `maxChars`
- `timeoutMs`
- `browser`
- `os`
- `removeImages`
- `includeReplies`

## When not to use it

Do not use this tool when:
- the page requires JS rendering
- you need login/session flows
- you need clicks, scrolling, or form submission
- a full browser session is required

In those cases, use browser automation instead.
