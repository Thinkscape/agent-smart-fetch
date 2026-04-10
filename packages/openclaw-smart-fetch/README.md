# openclaw-smart-fetch

OpenClaw plugin package for browser-fingerprinted fetching via `wreq-js` plus readable extraction via Defuddle.

## What it registers

- `defuddle_fetch`

## Install

From npm:

```bash
openclaw plugins install openclaw-smart-fetch
```

From a local checkout:

```bash
openclaw plugins install -l /absolute/path/to/agent-smart-fetch/packages/openclaw-smart-fetch
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

## OpenClaw config

See `openclaw.plugin.json` for the plugin config schema and defaults.
