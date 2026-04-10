# smart-fetch-core

Internal shared core for the `pi-smart-fetch` and `openclaw-smart-fetch` packages.

It contains the reusable fetch/extract pipeline, shared request schema helpers, shared batch fan-out helpers, bounded-concurrency scheduling, and shared response formatting.

## Shared capabilities

The core now covers both:
- single-item fetch execution
- batch fetch execution over an array of single-item requests

Batch behavior in the core:
- each item uses the same parameter surface as the single-fetch tool
- results are preserved in input order
- per-item success and error states are modeled explicitly
- per-item progress/status snapshots can be emitted for harnesses like pi
- bounded concurrency defaults to `8` unless the harness overrides it via settings/config
