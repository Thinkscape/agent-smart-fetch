---
name: smart-fetch
description: Guide for using real browser TLS-fingerprinted web fetching to extract clean, readable content from any URL. Bypasses Cloudflare, DataDome, and other bot detection.
version: 2.0.0
author: thinkscape
metadata:
  hermes:
    tags: [web, fetch, scraping, extraction, browser, TLS, fingerprinting, curl-impersonate, JA3]
prerequisites:
  pip: [curl_cffi, defuddle]
---

# Smart Fetch

Fetch web content with **real browser TLS fingerprinting** via curl-impersonate and **Defuddle article extraction**. This is not User-Agent spoofing — the actual TLS handshake (JA3/JA4 hash), HTTP/2 settings (Akamai fingerprint), and header order are replicated from real desktop browsers.

## When to use smart-fetch tools

| Scenario | Tool | Why |
|----------|------|-----|
| Read an article or blog post | `web_fetch` | Defuddle extracts clean markdown, stripping ads/nav |
| Fetch API documentation | `web_fetch` | Returns readable markdown from messy docs pages |
| Access a JSON API endpoint | `web_fetch(format="json")` | Pretty-printed JSON output |
| Cloudflare/DataDome blocked pages | `web_fetch(browser="chrome")` | Real TLS fingerprint matches actual Chrome |
| Bot-detected pages | `web_fetch(browser="firefox")` | Switch browser profile to evade detection |
| Multiple URLs at once | `batch_web_fetch` | Concurrent fetching, up to 10 URLs |
| Behind geo-restrictions | `web_fetch(proxy="socks5://...")` | Route through a proxy |

## When NOT to use

- **JavaScript-heavy SPAs** — these tools don't execute JS. Use a browser automation tool instead.
- **Web search** — use `web_search` for finding information, not `web_fetch`.
- **Authentication-required pages** — these tools don't manage sessions/cookies.

## How the fingerprinting works

The plugin uses **curl-impersonate** (via `curl_cffi`), which is a patched build of curl that replicates the exact TLS ClientHello, HTTP/2 connection preface, and header ordering of real browsers:

- **TLS layer**: Cipher suites, extensions, supported groups, ALPN, GREASE, key share order — produces the same JA3/JA4 hash as a real browser
- **HTTP/2 layer**: SETTINGS frame parameters, WINDOW_UPDATE, PRIORITY frames — matches the Akamai HTTP/2 fingerprint
- **Header layer**: Exact header casing and ordering (Chrome sends different casing than Firefox)
- **HTTP/3**: Also supported (curl_cffi v0.15+)

This is fundamentally different from setting a `User-Agent` string. A bot detector comparing the TLS handshake will see a perfect match for the impersonated browser.

## Browser profiles

### Short aliases (always pinned to latest available)
`chrome` (default), `firefox`, `safari`, `edge`, `chrome_android`, `safari_ios`

### Pinned desktop versions
| Browser | Available versions |
|---------|-------------------|
| **Chrome** | chrome99, chrome100, chrome101, chrome104, chrome107, chrome110, chrome116, chrome119, chrome120, chrome123, chrome124, chrome131, chrome133a, chrome136, chrome142, chrome145, chrome146 |
| **Firefox** | firefox133, firefox135, firefox144, firefox147 |
| **Safari** | safari153, safari155, safari170, safari180, safari184, safari260, safari2601 |
| **Edge** | edge99, edge101 |
| **Tor** | tor145 |

### Note on OS
The TLS fingerprint is **OS-agnostic** — Chrome 145 on Windows and macOS produce the same JA3 hash. curl_cffi's default User-Agent says macOS. Use the `os` parameter to override the platform hint in headers if you need to appear as a specific OS:

```
web_fetch(url="...", browser="chrome145", os="windows")
```

## web_fetch parameters

```
web_fetch(
    url,                    # Required. The URL to fetch.
    format="markdown",      # "markdown" | "html" | "text" | "json"
    browser="chrome",       # Browser to impersonate (short alias or pinned version)
    os=null,                # Override OS: "windows", "macos", "linux", "android", "ios"
    max_chars=50000,        # Truncate output to this many characters
    timeout_ms=15000,       # Request timeout in milliseconds
    remove_images=false,    # Strip image references from output
    proxy=null,             # Proxy: http://user:pass@host:port or socks5://host:port
)
```

## batch_web_fetch parameters

```
batch_web_fetch(
    requests=[              # Array of request objects (max 10)
        {
            "url": "...",
            "format": "markdown",
            "browser": "chrome",
            "os": null,
            "max_chars": 50000,
            "timeout_ms": 15000,
            "remove_images": false,
            "proxy": null
        },
        ...
    ]
)
```

## Effective patterns

### Fetch an article with metadata
```
web_fetch(url="https://example.com/blog/article-slug")
```
Returns a markdown document with a metadata header (title, author, site name, publish date).

### Bypass Cloudflare
```
web_fetch(url="https://protected.example.com/page", browser="chrome146")
```
Uses Chrome 146's exact TLS handshake — indistinguishable from a real Chrome browser.

### Switch browsers on detection
```
web_fetch(url="https://strict-bot-detection.example.com/article", browser="firefox147")
```
If Chrome is detected (e.g. known automation patterns), try Firefox or Safari.

### Fetch multiple documentation pages
```
batch_web_fetch(requests=[
    {"url": "https://docs.example.com/getting-started"},
    {"url": "https://docs.example.com/api-reference"},
    {"url": "https://docs.example.com/configuration"},
])
```

### Fetch a JSON API
```
web_fetch(url="https://api.example.com/v1/status", format="json")
```

### Fetch through a proxy
```
web_fetch(
    url="https://geo-restricted.example.com/page",
    proxy="socks5://localhost:9050"
)
```

### Image-free content extraction
```
web_fetch(
    url="https://example.com/long-article",
    remove_images=true,
    max_chars=10000
)
```

### Appear as Windows Chrome
```
web_fetch(url="https://example.com", browser="chrome145", os="windows")
```

## Output format

**Markdown format** (default):
```
> URL: https://example.com/article
> Title: Article Title
> Site: Example Site
> Author: Jane Doe
> Published: 2025-01-15
> Status: 200

Clean markdown content extracted by Defuddle...
```

**HTML format**: Returns raw HTML source from the response.

**Text format**: Returns plain text with all HTML stripped.

**JSON format**: Returns pretty-printed JSON with metadata, defuddle extraction data, and content length.

## Tips

1. **Use `"chrome"` (default) for most sites** — it always pins to the latest Chrome profile.
2. **Switch browsers on blocks** — if a site blocks Chrome, try `"firefox"` or `"safari"`. Each uses a completely different TLS stack.
3. **Don't pin versions unless needed** — short aliases (`chrome`, `firefox`) automatically update when curl_cffi is upgraded.
4. **Use batch for 3+ URLs** — `batch_web_fetch` runs up to 5 requests concurrently.
5. **Set `max_chars` conservatively** — large pages consume context tokens. 10,000–20,000 chars is often enough for analysis.
6. **Defuddle is automatic** — article extraction happens when the response is `text/html`. For JSON/API responses, raw content is returned.
7. **The `os` parameter is optional** — TLS fingerprints don't change across OS. Only set it if you need the headers to say "Windows" instead of "macOS".
