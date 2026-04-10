# pi-smart-fetch

pi.dev extension package for browser-fingerprinted fetching via `wreq-js` plus readable extraction via Defuddle.

## What it registers

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

## Tool parameters

Supported request parameters:
- `url`
- `browser`
- `os`
- `headers`
- `maxChars`
- `format`
- `removeImages`
- `includeReplies`
- `proxy`
- `verbose`

By default the response is compact and includes only non-empty URL, title, author, published, and content. Set `verbose: true` to include the full metadata header.

## pi settings

Optional custom settings in `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "webFetchVerboseByDefault": false,
  "webFetchDefaultMaxChars": 12000
}
```

Project settings override global settings.
