"""Tool handlers — browser-grade web fetching via curl_cffi + Defuddle extraction.

Uses curl_cffi (curl-impersonate bindings) for real TLS/JA3/JA4 and HTTP/2
fingerprinting that matches actual desktop browsers at the cryptographic level.
Defuddle handles article/content extraction from HTML.
"""

from __future__ import annotations

import html as html_module
import json
import logging
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_MAX_CHARS = 50_000
DEFAULT_TIMEOUT_MS = 15_000
DEFAULT_FORMAT = "markdown"
DEFAULT_IMPERSONATE = "chrome"

# curl_cffi impersonate target → default OS platform hint (for UA override)
# curl_cffi fingerprints are OS-agnostic at the TLS level; we only override
# the User-Agent and sec-ch-ua-platform if the user requests a specific OS.
_OS_PLATFORM_HEADERS: Dict[str, Dict[str, str]] = {
    "windows": {
        "sec-ch-ua-platform": '"Windows"',
    },
    "macos": {
        "sec-ch-ua-platform": '"macOS"',
    },
    "linux": {
        "sec-ch-ua-platform": '"Linux"',
    },
    "android": {
        "sec-ch-ua-platform": '"Android"',
    },
    "ios": {
        "sec-ch-ua-platform": '"iOS"',
    },
}


# ---------------------------------------------------------------------------
# URL validation
# ---------------------------------------------------------------------------


def _validate_url(url: str) -> Optional[str]:
    """Return an error string if URL is invalid, else None."""
    if not url or not url.strip():
        return "URL is empty"
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return f"Unsupported URL scheme: {parsed.scheme} (only http/https allowed)"
    if not parsed.hostname:
        return "URL has no hostname"
    return None


# ---------------------------------------------------------------------------
# Normalise browser names: accept both "chrome_145" and "chrome145" styles
# ---------------------------------------------------------------------------


def _normalise_impersonate(browser: str) -> str:
    """Normalise a browser name to curl_cffi's impersonate format.

    Accepts:
      - curl_cffi native:  "chrome145", "firefox147", "safari260", "edge101"
      - Underscore style:  "chrome_145", "firefox_147", "safari_26"
      - Short aliases:     "chrome", "firefox", "safari", "edge"
      - Android/iOS:       "chrome_android", "safari_ios"
    """
    b = browser.strip().lower()
    # Already a known short alias — pass through
    if b in ("chrome", "firefox", "safari", "edge", "chrome_android", "safari_ios"):
        return b
    # Remove underscores for version-based names: "chrome_145" → "chrome145"
    # But preserve "chrome_android" and "safari_ios" which use underscores intentionally
    if "_" in b and not b.endswith("_android") and not b.endswith("_ios"):
        b = b.replace("_", "")
    return b


# ---------------------------------------------------------------------------
# Defuddle extraction
# ---------------------------------------------------------------------------


def _extract_with_defuddle(html: str, url: str) -> Optional[Dict[str, Any]]:
    """Try Defuddle extraction for clean article content."""
    try:
        from defuddle import Defuddle

        d = Defuddle(html, url=url)
        result = d.parse()
        return {
            "title": getattr(result, "title", None) or "",
            "content": getattr(result, "content", None) or "",
            "description": getattr(result, "description", None) or "",
            "author": getattr(result, "author", None) or "",
            "site_name": getattr(result, "site_name", None) or "",
            "published_time": getattr(result, "published_time", None) or "",
            "word_count": getattr(result, "word_count", 0),
            "parse_time": getattr(result, "parse_time", 0),
        }
    except ImportError:
        logger.debug("defuddle not installed, skipping article extraction")
        return None
    except Exception as e:
        logger.debug("Defuddle extraction failed for %s: %s", url, e)
        return None


# ---------------------------------------------------------------------------
# HTML → Markdown fallback (no deps)
# ---------------------------------------------------------------------------


def _html_to_markdown(html: str) -> str:
    """Regex-based HTML-to-markdown for when Defuddle isn't available."""
    for tag in ("script", "style", "nav", "footer", "header", "noscript"):
        html = re.sub(rf"<{tag}[^>]*>.*?</{tag}>", "", html, flags=re.DOTALL | re.IGNORECASE)

    for i in range(1, 7):
        html = re.sub(
            rf"<h{i}[^>]*>(.*?)</h{i}>", rf"{'#' * i} \1\n", html,
            flags=re.DOTALL | re.IGNORECASE,
        )
    html = re.sub(r"<p[^>]*>(.*?)</p>", r"\1\n\n", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
    html = re.sub(r"<strong[^>]*>(.*?)</strong>", r"**\1**", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<b[^>]*>(.*?)</b>", r"**\1**", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<em[^>]*>(.*?)</em>", r"*\1*", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<i[^>]*>(.*?)</i>", r"*\1*", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<code[^>]*>(.*?)</code>", r"`\1`", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<pre[^>]*>(.*?)</pre>", r"```\n\1\n```", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(
        r"<a[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", r"[\2](\1)",
        html, flags=re.DOTALL | re.IGNORECASE,
    )
    html = re.sub(r"<li[^>]*>(.*?)</li>", r"- \1\n", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<[^>]+>", "", html)
    html = re.sub(r"\n{3,}", "\n\n", html)
    html = re.sub(r"^[ \t]+", "", html, flags=re.MULTILINE)
    return html_module.unescape(html).strip()


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------


def _format_output(
    raw_text: str,
    metadata: Dict[str, Any],
    defuddle_result: Optional[Dict[str, Any]],
    output_format: str,
    max_chars: int,
    remove_images: bool,
) -> str:
    """Format fetched content according to the requested output format."""
    if output_format == "markdown":
        if defuddle_result and defuddle_result.get("content"):
            body = defuddle_result["content"]
            if remove_images:
                body = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", body)
                body = re.sub(r"<img[^>]*>", "", body)
        else:
            body = _html_to_markdown(raw_text)
        if len(body) > max_chars:
            body = body[:max_chars] + f"\n\n... (truncated at {max_chars} chars)"

        # Metadata header
        parts = [f"> URL: {metadata.get('url', '')}"]
        if defuddle_result:
            for key, label in [("title", "Title"), ("site_name", "Site"),
                               ("author", "Author"), ("published_time", "Published")]:
                val = defuddle_result.get(key, "")
                if val:
                    parts.append(f"> {label}: {val}")
        status = metadata.get("status_code")
        if status:
            parts.append(f"> Status: {status}")
        parts.append("")
        return "\n".join(parts) + "\n" + body

    elif output_format == "html":
        body = raw_text
        if len(body) > max_chars:
            body = body[:max_chars] + f"\n<!-- truncated at {max_chars} chars -->"
        return body

    elif output_format == "text":
        body = _html_to_markdown(raw_text)
        if remove_images:
            body = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", body)
        if len(body) > max_chars:
            body = body[:max_chars] + f"\n... (truncated at {max_chars} chars)"
        return body

    elif output_format == "json":
        data = {
            "metadata": metadata,
            "defuddle": defuddle_result,
            "content_length": len(raw_text),
        }
        text = json.dumps(data, indent=2, ensure_ascii=False)
        return text[:max_chars] if len(text) > max_chars else text

    return raw_text[:max_chars]


# ---------------------------------------------------------------------------
# Core fetch via curl_cffi
# ---------------------------------------------------------------------------


def _do_fetch(
    url: str,
    format: str = DEFAULT_FORMAT,
    browser: str = DEFAULT_IMPERSONATE,
    os_profile: Optional[str] = None,
    max_chars: int = DEFAULT_MAX_CHARS,
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
    remove_images: bool = False,
    proxy: Optional[str] = None,
    extra_headers: Optional[Dict[str, str]] = None,
) -> str:
    """Fetch a URL using curl_cffi with real TLS/HTTP2 browser fingerprinting."""
    err = _validate_url(url)
    if err:
        return json.dumps({"error": err, "url": url})

    try:
        from curl_cffi import requests as curl_requests
    except ImportError:
        return json.dumps({
            "error": "curl_cffi is not installed. Install with: pip install curl_cffi",
            "url": url,
        })

    impersonate = _normalise_impersonate(browser)
    timeout_sec = timeout_ms / 1000.0

    # Build headers — curl_cffi sets browser-accurate headers automatically
    # but we override the platform hint if the user wants a specific OS
    headers: Dict[str, str] = {}
    if os_profile and os_profile in _OS_PLATFORM_HEADERS:
        headers.update(_OS_PLATFORM_HEADERS[os_profile])
    if extra_headers:
        headers.update(extra_headers)

    # Build proxy dict (curl_cffi uses requests-style proxy format)
    proxies = None
    if proxy:
        proxies = {"https": proxy, "http": proxy}

    try:
        response = curl_requests.get(
            url,
            impersonate=impersonate,
            headers=headers or None,
            timeout=timeout_sec,
            allow_redirects=True,
            max_redirects=10,
            proxies=proxies,
        )

        metadata = {
            "url": str(response.url),
            "original_url": url,
            "status_code": response.status_code,
            "content_type": response.headers.get("content-type", ""),
            "content_length": len(response.text),
        }

        raw_text = response.text

        # Defuddle extraction for HTML pages
        content_type = response.headers.get("content-type", "")
        defuddle_result = None
        if "text/html" in content_type:
            defuddle_result = _extract_with_defuddle(raw_text, str(response.url))

        return _format_output(
            raw_text=raw_text,
            metadata=metadata,
            defuddle_result=defuddle_result,
            output_format=format,
            max_chars=max_chars,
            remove_images=remove_images,
        )

    except ImportError:
        return json.dumps({"error": "curl_cffi is not installed", "url": url})
    except Exception as e:
        # curl_cffi raises generic exceptions; extract what we can
        err_name = type(e).__name__
        err_msg = str(e)
        if "timed out" in err_msg.lower() or "timeout" in err_name.lower():
            return json.dumps({"error": f"Request timed out after {timeout_ms}ms", "url": url})
        if "redirect" in err_msg.lower():
            return json.dumps({"error": "Too many redirects", "url": url})
        if "connect" in err_msg.lower() or "resolve" in err_msg.lower():
            return json.dumps({"error": f"Connection failed: {err_msg}", "url": url})
        return json.dumps({"error": f"Fetch failed: {err_name}: {err_msg}", "url": url})


# ---------------------------------------------------------------------------
# Tool handlers (public API — called by Hermes)
# ---------------------------------------------------------------------------


def web_fetch(args: dict, **kwargs) -> str:
    """Fetch a single URL with real browser TLS fingerprinting and content extraction.

    Returns a formatted string (markdown/html/text/json depending on format param).
    """
    url = args.get("url", "").strip()
    if not url:
        return json.dumps({"error": "No URL provided"})

    return _do_fetch(
        url=url,
        format=args.get("format", DEFAULT_FORMAT),
        browser=args.get("browser", DEFAULT_IMPERSONATE),
        os_profile=args.get("os"),
        max_chars=args.get("max_chars", DEFAULT_MAX_CHARS),
        timeout_ms=args.get("timeout_ms", DEFAULT_TIMEOUT_MS),
        remove_images=args.get("remove_images", False),
        proxy=args.get("proxy"),
    )


def batch_web_fetch(args: dict, **kwargs) -> str:
    """Fetch multiple URLs concurrently with real browser TLS fingerprinting.

    Returns a single formatted string with per-item results.
    """
    requests_list = args.get("requests", [])
    if not requests_list:
        return json.dumps({"error": "No requests provided"})

    if not isinstance(requests_list, list):
        return json.dumps({"error": "'requests' must be an array"})

    if len(requests_list) > 10:
        return json.dumps({"error": f"Too many requests ({len(requests_list)}). Maximum is 10 per batch."})

    import concurrent.futures

    def _fetch_one(req: dict) -> dict:
        url = req.get("url", "").strip()
        if not url:
            return {"url": "", "error": "No URL provided"}
        result = _do_fetch(
            url=url,
            format=req.get("format", DEFAULT_FORMAT),
            browser=req.get("browser", DEFAULT_IMPERSONATE),
            os_profile=req.get("os"),
            max_chars=req.get("max_chars", DEFAULT_MAX_CHARS),
            timeout_ms=req.get("timeout_ms", DEFAULT_TIMEOUT_MS),
            remove_images=req.get("remove_images", False),
            proxy=req.get("proxy"),
        )
        # Check if result is an error JSON
        try:
            parsed = json.loads(result)
            if "error" in parsed:
                return {"url": url, "error": parsed["error"]}
        except (json.JSONDecodeError, TypeError):
            pass
        return {"url": url, "content": result}

    results: List[tuple] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(requests_list), 5)) as executor:
        futures = {executor.submit(_fetch_one, req): i for i, req in enumerate(requests_list)}
        for future in concurrent.futures.as_completed(futures):
            idx = futures[future]
            try:
                results.append((idx, future.result()))
            except Exception as e:
                url = requests_list[idx].get("url", "")
                results.append((idx, {"url": url, "error": str(e)}))

    results.sort(key=lambda x: x[0])

    parts = []
    for _, item in results:
        url = item.get("url", "unknown")
        if "error" in item:
            parts.append(f"## ❌ {url}\nError: {item['error']}\n")
        else:
            parts.append(f"---\n## {url}\n\n{item['content']}\n")

    return "\n\n".join(parts)
