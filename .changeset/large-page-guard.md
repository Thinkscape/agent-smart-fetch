minor

Stop very large pages from freezing the agent (#20). Text responses are now
read up to `maxResponseBytes` (default 1 MiB; `smartFetchDefaultMaxResponseBytes`
in pi, `maxResponseBytes` in the OpenClaw plugin config, `--max-response-bytes`
in the CLI); longer pages are cut there and reported with a `Truncated:`
metadata line, and oversized JSON returns a `response_too_large` error. HTML
parsing and Defuddle extraction run on a worker thread that is terminated after
`timeoutMs`, so the host event loop stays responsive.
