# Plan

## Context
- Investigate better support for host-served markdown in the core extraction pipeline.
- User observed that `https://docs.openclaw.ai/plugins/memory-wiki` serves proper markdown when the request includes `Accept: text/x-markdown`.
- Need to assess whether `packages/core/src/extract.ts` should advertise markdown in `Accept`, detect markdown responses, and short-circuit before Defuddle.
- Need to add the OpenClaw docs site to integration coverage and understand what changes in behavior.
- Current live behavior:
  - With the existing default `Accept` (`text/html,...,*/*`), the OpenClaw docs page responds with `text/html` and the current Defuddle path succeeds (`title: "Memory Wiki"`, `wordCount: 1128`, content length ≈ 9.4k chars).
  - With `Accept: text/x-markdown` or `Accept: text/markdown`, the same page responds with `content-type: text/markdown; charset=utf-8` and current code fails with `No content extracted...` because it still routes that response through Defuddle.
  - Important negotiation detail: on this host, simply appending markdown later in the `Accept` list does **not** switch the response to markdown; markdown has to be the first/explicit preferred media type to flip Mintlify into its raw markdown endpoint.
  - Direct content comparison for this page:
    - Server-served markdown is longer (≈ 10.9k chars) because it includes Mintlify-added preamble/noise: a `Documentation Index` blockquote, an `<AgentInstructions>` block, duplicate `# Memory Wiki` headings, relative links, a `Related docs` section, and a `Built with Mintlify` footer.
    - Our current HTML→Defuddle path removes that wrapper noise, deduplicates the title, keeps the main doc body, rewrites at least some relative links to absolute URLs, and returns cleaner agent-facing markdown.

## Approach
- Inspect the current fetch/extract pipeline, test coverage, and any existing markdown/text handling.
- Verify the live OpenClaw docs endpoint behavior with and without markdown-focused `Accept` headers.
- Recommend a concrete implementation approach for markdown response detection and early return, reusing existing formatting/truncation helpers where possible.
- Extend integration tests to cover the real OpenClaw docs case and document expected assertions.
- Keep HTML as a viable fallback path; if markdown is advertised in `Accept`, do so without breaking existing HTML-first extraction for sites that only behave well with HTML.
- Account for the fact that Mintlify appears to key off `Accept` ordering, not just `q` values, when deciding between HTML and raw markdown.

## Files to modify
- Likely `packages/core/src/extract.ts`
- Likely `packages/core/src/constants.ts`
- Likely `packages/core/test/unit/extract.unit.test.ts`
- Likely `packages/core/test/integration/extract.integration.test.ts`

## Reuse
- `packages/core/src/extract.ts` — existing fetch pipeline, content-type gate, Defuddle invocation, and response shaping. Note: it already treats `text/markdown` as an allowed content type but does not branch on it.
- `packages/core/src/format.ts` — existing `markdownToText` and `truncateContent` helpers for normalization/truncation.
- `packages/core/src/constants.ts` — default `Accept` / `Accept-Language` headers.
- `packages/core/test/unit/extract.unit.test.ts` — existing mocked fetch/Defuddle tests that can be extended to verify header negotiation and markdown short-circuit behavior.
- Existing result shaping in `extract.ts` already returns empty-string defaults for metadata, which is likely the simplest path for raw markdown responses unless we deliberately add markdown metadata parsing.

## Steps
- [x] Confirm how the OpenClaw docs endpoint responds to different `Accept` headers and content types.
- [ ] Identify where to broaden `Accept` negotiation and how to detect markdown responses safely.
- [ ] Define how markdown responses should map to existing `format` options (`markdown`, `html`, `text`).
- [ ] Add/update unit tests for markdown content-type handling and early-return behavior.
- [ ] Add/update integration tests for the OpenClaw docs endpoint.

## Open questions
- Should the default `Accept` header be changed globally now, or should markdown short-circuit support land first while keeping HTML-first negotiation unchanged?
- If raw markdown is returned, what should `format: "html"` do?
- Is it acceptable for the first markdown-path implementation to leave metadata mostly empty (except perhaps title if trivially derivable), rather than introducing a markdown metadata parser now?

## Verification
- Run/update unit tests for `packages/core/test/unit/extract.unit.test.ts`.
- Run/update integration tests for `packages/core/test/integration/extract.integration.test.ts` with `RUN_INTEGRATION=1`.
- Manually compare the OpenClaw docs response with default vs markdown-aware `Accept` headers to validate the expected extraction path.
- Re-check that the existing integration suite still passes for HTML-first sites after any `Accept` header changes.
- For OpenClaw specifically, compare whether the new markdown short-circuit should preserve raw host instructions/footer or apply light normalization before returning.
