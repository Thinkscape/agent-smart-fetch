# Plan: Add `raw` output format

## Context

Currently the tool supports four output formats: `markdown`, `html`, `text`, `json`. These all run content through Defuddle extraction (stripping nav, sidebars, ads, etc.) and apply truncation. There's no way for an agent to retrieve the full, untouched server response — e.g., the raw HTML for further parsing.

We're adding a `raw` format that:
- Uses wreq-js for TLS fingerprinting (same as other formats)
- Uses a browser-like `Accept` header (HTML, XML, JSON, markdown, `*/*`)
- Returns the full, unmodified response body — no Defuddle content extraction or stripping
- May still call Defuddle for site-specific workarounds (e.g. X/Twitter deleted-tweet detection), but ignores Defuddle's extracted content and returns raw body
- Does not truncate by default
- Includes `Content-Type` from the server in the metadata header block
- Binary/attachment responses: in a TTY, streams to a temp file (same as other formats); when piping, streams raw bytes to stdout with metadata on stderr

## Approach

The changes touch the full stack:

1. **Type system** — extend `OutputFormat` union with `"raw"`, add optional `contentType` field to `BaseFetchResult`
2. **Core extract pipeline** — add a `raw` branch that fetches normally, skips Defuddle content extraction, returns full raw body
3. **Format/response builders** — include `Content-Type` in metadata headers when present
4. **Tool schema** — add `"raw"` literal to the format union
5. **CLI** — add `--raw` shorthand flag, accept `"raw"` in `--format`
6. **Pi extension** — add `"raw"` literal to format union
7. **OpenClaw extension** — add `"raw"` literal to format union
8. **Skills & READMEs** — document the new format

### Key design decisions

- **Defuddle for workarounds only**: For raw mode, Defuddle is still called on X/Twitter URLs so the oEmbed-based deleted-tweet detection works. But the returned content is always the raw body, never Defuddle's extraction output.
- **No default truncation for raw**: The `maxChars` default won't apply to raw — content is returned in full. A user can still pass `maxChars` to cap it.
- **Content-Type in metadata**: The `contentType` from the response headers is added as an optional field on `FetchResult`, and both `buildMetadataHeader` and `buildCompactMetadataHeader` include it when present.

## Files to modify

### Core package (`packages/core/src/`)

| File         | Change                                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`   | Add `"raw"` to `OutputFormat`. Add optional `contentType?: string` to `BaseFetchResult`.                                                                                         |
| `extract.ts` | Add `raw` branch in `createDefuddleFetch` — skip Defuddle extraction, return raw body. Still call Defuddle for X/Twitter workaround detection. Populate `contentType` on result. |
| `format.ts`  | Include `Content-Type` in metadata headers when `result.contentType` is present.                                                                                                 |
| `tool.ts`    | Add `Type.Literal("raw")` to the format union. Update description.                                                                                                               |

### CLI package (`packages/smart-fetch/src/`)

| File     | Change                                                                            |
| -------- | --------------------------------------------------------------------------------- |
| `cli.ts` | Add `--raw` shorthand flag. Add `"raw"` to valid format values. Update help text. |

### Pi extension (`packages/pi-smart-fetch/src/`)

| File       | Change                                         |
| ---------- | ---------------------------------------------- |
| `index.ts` | Add `Type.Literal("raw")` to the format union. |

### OpenClaw extension (`packages/openclaw-smart-fetch/src/`)

| File       | Change                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| `index.ts` | Add `Type.Literal("raw")` to the format union (via `createBaseFetchToolParameterProperties` which gets it from `tool.ts`). |

### Skills & docs

| File                                                        | Change                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| `packages/openclaw-smart-fetch/skills/smart-fetch/SKILL.md` | Add `raw` format to parameter docs and explain when to use it. |
| `packages/smart-fetch/README.md`                            | Add `raw` to output formats table.                             |
| `packages/pi-smart-fetch/README.md`                         | Add `raw` to output formats table.                             |
| `packages/openclaw-smart-fetch/README.md`                   | Add `raw` to output formats table.                             |
| `README.md` (root)                                          | Update format list if needed.                                  |

## Reuse

- **`DEFAULT_ACCEPT_HEADER`** in `constants.ts` — browser-like Accept header; for raw mode we add `application/json` explicitly into the mix so JSON endpoints also respond naturally
- **Existing fetch pipeline** in `extract.ts` — raw mode reuses the wreq-js fetch setup, redirect handling, file download handling, and error handling
- **`isTwitterJsDisabledPage()`** — DOM-based X/Twitter detection that works without Defuddle
- **`buildHeader()`** in `format.ts` — already used for metadata formatting, just needs an extra `Content-Type` entry
- **Existing schema helpers** — `createBaseFetchToolParameterProperties` in `tool.ts` already generates the format union; just need to add one more literal
- **`resolveAcceptHeader()`** in `extract.ts` — already maps format to Accept header; raw maps to the new `DEFAULT_RAW_ACCEPT_HEADER`
- **`streamResponseToFile()`** in `extract.ts` — reusable for the pipe case; CLI reads the temp file and streams to stdout

## Steps

### Step 1: Extend types

- [ ] Add `"raw"` to `OutputFormat` union in `packages/core/src/types.ts`
- [ ] Add optional `contentType?: string` to `BaseFetchResult` in `packages/core/src/types.ts`

### Step 2: Add raw Accept header constant

- [ ] In `packages/core/src/constants.ts`, add `DEFAULT_RAW_ACCEPT_HEADER`:
  `"text/html,application/xhtml+xml,application/json,application/xml;q=0.9,text/markdown;q=0.8,text/plain;q=0.8,*/*;q=0.7"`
- [ ] In `extract.ts`, use this new header when format is `"raw"`

### Step 3: Implement raw logic in extract pipeline

- [ ] In `createDefuddleFetch` (`packages/core/src/extract.ts`), after getting `rawBody` and handling client-side redirects, add a `raw` format branch that:
  - For file downloads (binary/attachment): same as current behavior — stream to file, return `FileFetchResult` with `contentType` populated
  - For all text responses (HTML, JSON, plain text, markdown, etc.): skip Defuddle extraction entirely, return raw body as-is
  - Still call Defuddle for X/Twitter URLs so deleted-tweet detection works (oEmbed 404 check); return 404 error if tweet is gone, otherwise return raw body
  - Populate `result.contentType` from response `Content-Type` header
  - Skip default `maxChars` truncation entirely — only truncate if user explicitly passed `maxChars`
- [ ] Ensure error handling (timeouts, HTTP errors, network errors) still works for raw mode

### Step 4: Include Content-Type in metadata headers

- [ ] In `buildMetadataHeader()` and `buildCompactMetadataHeader()` in `packages/core/src/format.ts`, add `Content-Type` line when `result.contentType` is present

### Step 5: Update tool schema

- [ ] In `createBaseFetchToolParameterProperties()` in `packages/core/src/tool.ts`, add `Type.Literal("raw")` to the format union
- [ ] Update the format parameter description to mention `"raw"` — "raw server response without extraction or truncation (for further parsing)"

### Step 6: Update CLI

- [ ] Add `--raw` shorthand flag in `parseCliArgs()` in `packages/smart-fetch/src/cli.ts`
- [ ] Add `"raw"` to the valid format array
- [ ] Update help text — add `--raw` option and mention it in EXAMPLES
- [ ] Ensure batch mode passes through `raw` format correctly
- [ ] Handle binary/attachment in raw mode for pipe vs TTY:
  - When piping (`isStdoutPiped()`): if the result is a `FileFetchResult`, read the temp file and stream it to stdout; write the metadata header to stderr
  - When TTY: keep current behavior (report file path in output)

### Step 7: Update Pi extension

- [ ] No code changes needed if using shared schema helper from core (which already includes `"raw"`). Verify format literals are in sync.

### Step 8: Update OpenClaw extension

- [ ] Same as Pi — `createBaseFetchToolParameterProperties` is already used. Verify.

### Step 9: Update skills and documentation

- [ ] Update `packages/openclaw-smart-fetch/skills/smart-fetch/SKILL.md`:
  - Add `raw` to the format parameter docs
  - Explain: "returns the full raw server response (HTML/markdown/JSON/etc) without extraction or truncation — useful for further parsing"
- [ ] Update `packages/smart-fetch/README.md`: add `raw` to output formats table
- [ ] Update `packages/pi-smart-fetch/README.md`: add `raw` to output formats table
- [ ] Update `packages/openclaw-smart-fetch/README.md`: add `raw` to output formats table

### Step 10: Tests

- [ ] Add unit test for raw format metadata (Content-Type in headers) in `packages/core/test/unit/format.test.ts`
- [ ] Add unit test for raw format extract behavior in `packages/core/test/unit/extract.unit.test.ts`

## Verification

1. **Build**: `bun run build` — all packages compile without errors
2. **Type check**: `bun run typecheck` — no type errors
3. **Unit tests**: `bun run test` — all tests pass
4. **CLI smoke test (TTY)**: `smart-fetch https://example.com --raw` — returns full HTML with `Content-Type` in metadata header
5. **CLI pipe test**: `smart-fetch https://example.com --raw | head -20` — raw HTML streams to stdout, metadata on stderr
6. **CLI binary pipe test**: `smart-fetch https://example.com/image.png --raw | file -` — binary streams to stdout
7. **Pi test**: Run `web_fetch(url, format: "raw")` in pi — agent receives raw response with Content-Type
8. **OpenClaw test**: Run `smart_fetch(url, format: "raw")` — agent receives raw response
