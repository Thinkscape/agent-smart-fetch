"""Hermes smart-fetch plugin — registration.

Registers web_fetch and batch_web_fetch tools powered by curl_cffi for real
TLS/JA3/JA4 + HTTP/2 browser fingerprinting, plus Defuddle article extraction
and a bundled skill.
"""

import logging
from pathlib import Path

from . import schemas, tools

logger = logging.getLogger(__name__)


def register(ctx):
    """Wire schemas to handlers and register bundled skills."""
    # --- Tools ---
    ctx.register_tool(
        name="web_fetch",
        toolset="smart-fetch",
        schema=schemas.WEB_FETCH_SCHEMA,
        handler=tools.web_fetch,
        description=(
            "Fetch a URL with real browser TLS/JA3/HTTP2 fingerprinting via "
            "curl-impersonate and extract clean readable content via Defuddle"
        ),
        emoji="🌐",
    )

    ctx.register_tool(
        name="batch_web_fetch",
        toolset="smart-fetch",
        schema=schemas.BATCH_WEB_FETCH_SCHEMA,
        handler=tools.batch_web_fetch,
        description=(
            "Fetch multiple URLs concurrently with real browser TLS fingerprinting"
        ),
        emoji="🌐",
    )

    # --- Bundled skills ---
    skills_dir = Path(__file__).parent / "skills"
    for child in sorted(skills_dir.iterdir()):
        skill_md = child / "SKILL.md"
        if child.is_dir() and skill_md.exists():
            ctx.register_skill(child.name, skill_md)
            logger.info("smart-fetch: registered skill '%s'", child.name)

    logger.info("smart-fetch plugin registered (2 tools, bundled skills)")
