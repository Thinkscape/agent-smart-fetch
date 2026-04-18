"""Tool schemas — what the LLM sees to decide when to call each tool.

Browser names follow curl_cffi's impersonate targets: real TLS/JA3/JA4 + HTTP/2
fingerprints captured from actual desktop browsers (Chrome, Firefox, Safari, Edge).
"""

WEB_FETCH_SCHEMA = {
    "name": "web_fetch",
    "description": (
        "Fetch a single URL with real browser TLS fingerprinting and extract clean, "
        "readable content. Uses curl_cffi (curl-impersonate) for authentic TLS/JA3/JA4 "
        "and HTTP/2 fingerprints that match real desktop browsers at the cryptographic "
        "level, plus Defuddle for article extraction. Returns full metadata plus the "
        "extracted document. Does NOT execute JavaScript — use a browser automation tool "
        "for JS-heavy pages.\n\n"
        "When to use:\n"
        "- Fetching article/blog/documentation pages for readable content\n"
        "- Reading API responses, JSON endpoints, or raw HTML\n"
        "- Pages that block simple HTTP clients (Cloudflare, DataDome, etc.)\n"
        "- Extracting clean markdown from messy web pages\n\n"
        "When NOT to use:\n"
        "- Pages that require JavaScript rendering (use browser tool instead)\n"
        "- Searching the web (use web_search instead)"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "URL to fetch (http or https only)",
            },
            "format": {
                "type": "string",
                "enum": ["markdown", "html", "text", "json"],
                "description": (
                    "Output format. 'markdown' (default) for clean readable text, "
                    "'html' for cleaned HTML, 'text' for plain text, 'json' for "
                    "pretty-printed JSON with metadata."
                ),
            },
            "browser": {
                "type": "string",
                "description": (
                    "Browser to impersonate at the TLS/HTTP2 level. Uses curl-impersonate "
                    "for real cryptographic fingerprints — not just User-Agent spoofing.\n"
                    "Short aliases (always latest): chrome (default), firefox, safari, edge, "
                    "chrome_android, safari_ios.\n"
                    "Pinned versions: chrome145, chrome146, chrome131, chrome124, firefox147, "
                    "firefox144, safari260, safari2601, safari184, edge101, tor145.\n"
                    "Default: chrome"
                ),
            },
            "os": {
                "type": "string",
                "description": (
                    "Override the OS platform hint in headers. curl_cffi fingerprints are "
                    "OS-agnostic at the TLS level (Chrome on Windows and macOS produce the "
                    "same JA3 hash). This only changes sec-ch-ua-platform and related headers.\n"
                    "Options: windows, macos, linux, android, ios.\n"
                    "Default: macOS (curl_cffi default — leave unset unless you need a "
                    "specific OS appearance)."
                ),
            },
            "max_chars": {
                "type": "integer",
                "description": "Maximum characters to return. Default: 50000.",
            },
            "timeout_ms": {
                "type": "integer",
                "description": "Request timeout in milliseconds. Default: 15000.",
            },
            "remove_images": {
                "type": "boolean",
                "description": "Strip image references from output. Default: false.",
            },
            "proxy": {
                "type": "string",
                "description": (
                    "Proxy URL. Formats: http://user:pass@host:port or "
                    "socks5://host:port"
                ),
            },
        },
        "required": ["url"],
    },
}

BATCH_WEB_FETCH_SCHEMA = {
    "name": "batch_web_fetch",
    "description": (
        "Fetch multiple URLs concurrently with real browser TLS fingerprinting and "
        "content extraction. Each request accepts the same parameters as web_fetch. "
        "Up to 10 URLs per call, executed in parallel. Uses curl_cffi (curl-impersonate) "
        "for authentic TLS/JA3/JA4 + HTTP/2 fingerprints. Does NOT execute JavaScript.\n\n"
        "When to use:\n"
        "- Fetching multiple URLs in parallel for efficiency\n"
        "- Batch-reading documentation pages, API docs, or reference material\n"
        "- Comparing content across multiple URLs\n\n"
        "When NOT to use:\n"
        "- Single URL (use web_fetch instead)\n"
        "- More than 10 URLs at once (split into smaller batches)"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "requests": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "url": {
                            "type": "string",
                            "description": "URL to fetch (http or https only)",
                        },
                        "format": {
                            "type": "string",
                            "enum": ["markdown", "html", "text", "json"],
                            "description": "Output format. Default: markdown.",
                        },
                        "browser": {
                            "type": "string",
                            "description": "Browser to impersonate. Default: chrome.",
                        },
                        "os": {
                            "type": "string",
                            "description": "OS platform hint. Default: macOS.",
                        },
                        "max_chars": {
                            "type": "integer",
                            "description": "Max characters per item. Default: 50000.",
                        },
                        "timeout_ms": {
                            "type": "integer",
                            "description": "Per-request timeout in ms. Default: 15000.",
                        },
                        "remove_images": {
                            "type": "boolean",
                            "description": "Strip image references. Default: false.",
                        },
                        "proxy": {
                            "type": "string",
                            "description": "Proxy URL for this request.",
                        },
                    },
                    "required": ["url"],
                },
                "description": "Array of fetch requests. Each item accepts the same parameters as web_fetch.",
                "minItems": 1,
            },
        },
        "required": ["requests"],
    },
}
