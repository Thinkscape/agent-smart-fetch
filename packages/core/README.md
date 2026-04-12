# smart-fetch-core

Internal shared core for the `pi-smart-fetch` and `openclaw-smart-fetch` packages.

It contains the reusable fetch/extract pipeline, shared request schema helpers, shared batch fan-out helpers, bounded-concurrency scheduling, and shared response formatting.

The core now targets Thinkscape's maintained `@thinkscape/wreq-js` fork, which preserves the upstream fetch/session API shape while adding room for richer request diagnostics and transport-phase progress.

## Shared capabilities

The core now covers both:
- single-item fetch execution
- batch fetch execution over an array of single-item requests
- attachment/binary detection and temp-file streaming

Batch behavior in the core:
- each item uses the same parameter surface as the single-fetch tool
- results are preserved in input order
- per-item success and error states are modeled explicitly
- per-item progress/status snapshots can be emitted for harnesses like pi
- bounded concurrency defaults to `8` unless the harness overrides it via settings/config
- weighted progress can be driven by transport events from the fetch layer, with early network milestones, body download, and final parsing contributing different fractions of total progress

Attachment/binary behavior in the core:
- if `Content-Disposition: attachment` is present, the response is treated as a file download
- if the content type is non-textual, the response is streamed to disk instead of being forced through Defuddle
- temp directories can be provided by the consumer (`pi-smart-fetch`, `openclaw-smart-fetch`, or another harness)
- filenames are derived from `Content-Disposition`, URL path segments, or a UUID fallback
- basenames and extensions are deburred and sanitized before writing
- files are written without executable bits
- file-mode responses expose `URL`, `File size`, `Mime type`, and `File path`

## Recent feature additions reflected here

Recent `feat:` work added:
- publish-ready TypeScript/build/test tooling across the monorepo
- timer-driven progress animation support for pi batch fetch rendering
- attachment and binary streaming support in the shared fetch pipeline
