/**
 * URL safety validation: blocks SSRF attacks by rejecting requests to
 * private/internal IPs, cloud metadata endpoints, and loopback addresses.
 *
 * Called both pre-request (on user-supplied URL) and post-redirect
 * (on the final resolved URL) to prevent DNS rebinding and redirect-based
 * SSRF bypasses.
 */

import type { FetchError } from "./types";

/**
 * IPv4 private/reserved ranges that should never be reachable from an
 * outbound web-fetch tool. Each entry is [networkBits, prefixLength].
 */
const BLOCKED_IPV4_RANGES: Array<{ network: number; mask: number }> = [
  // 127.0.0.0/8 — loopback
  { network: 0x7f000000, mask: 0xff000000 },
  // 10.0.0.0/8 — RFC 1918
  { network: 0x0a000000, mask: 0xff000000 },
  // 172.16.0.0/12 — RFC 1918
  { network: 0xac100000, mask: 0xfff00000 },
  // 192.168.0.0/16 — RFC 1918
  { network: 0xc0a80000, mask: 0xffff0000 },
  // 169.254.0.0/16 — link-local (includes cloud metadata 169.254.169.254)
  { network: 0xa9fe0000, mask: 0xffff0000 },
  // 0.0.0.0/8 — "this" network
  { network: 0x00000000, mask: 0xff000000 },
  // 100.64.0.0/10 — shared address space (CGNAT, RFC 6598)
  { network: 0x64400000, mask: 0xffc00000 },
  // 192.0.0.0/24 — IETF protocol assignments
  { network: 0xc0000000, mask: 0xffffff00 },
  // 192.0.2.0/24 — TEST-NET-1
  { network: 0xc0000200, mask: 0xffffff00 },
  // 198.51.100.0/24 — TEST-NET-2
  { network: 0xc6336400, mask: 0xffffff00 },
  // 203.0.113.0/24 — TEST-NET-3
  { network: 0xcb007100, mask: 0xffffff00 },
  // 198.18.0.0/15 — benchmarking
  { network: 0xc6120000, mask: 0xfffe0000 },
  // 224.0.0.0/4 — multicast
  { network: 0xe0000000, mask: 0xf0000000 },
  // 240.0.0.0/4 — reserved
  { network: 0xf0000000, mask: 0xf0000000 },
  // 255.255.255.255/32 — broadcast
  { network: 0xffffffff, mask: 0xffffffff },
];

/**
 * Well-known cloud metadata hostnames that should be blocked.
 */
const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "kubernetes.default.svc",
  "kubernetes.default",
]);

/**
 * Parse an IPv4 address string into a 32-bit unsigned integer, or null
 * if not a valid IPv4 address.
 */
function parseIPv4(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    const octet = Number.parseInt(part, 10);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    if (part !== String(octet)) return null; // reject leading zeros like "01"
    result = (result << 8) | octet;
  }

  return result >>> 0; // ensure unsigned
}

/**
 * Check if an IPv4 address (as a 32-bit unsigned int) falls within any
 * blocked range.
 */
function isBlockedIPv4(ip: number): boolean {
  for (const { network, mask } of BLOCKED_IPV4_RANGES) {
    if ((ip & mask) === (network & mask)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if an IPv6 address string represents a blocked destination.
 * Covers: loopback (::1), link-local (fe80::/10), unique-local (fc00::/7),
 * IPv4-mapped (::ffff:x.x.x.x where x.x.x.x is blocked), and
 * deprecated site-local (fec0::/10).
 */
function isBlockedIPv6(address: string): boolean {
  const normalized = address.toLowerCase().trim();

  // ::1 — loopback
  if (normalized === "::1" || normalized === "0000:0000:0000:0000:0000:0000:0000:0001") {
    return true;
  }

  // :: — unspecified
  if (normalized === "::" || normalized === "0000:0000:0000:0000:0000:0000:0000:0000") {
    return true;
  }

  // fe80::/10 — link-local
  if (/^fe[89ab]/i.test(normalized)) {
    return true;
  }

  // fc00::/7 — unique local address (ULA)
  if (/^f[cd]/i.test(normalized)) {
    return true;
  }

  // fec0::/10 — deprecated site-local (covers fec0:: through feff::)
  if (/^fe[c-f]/i.test(normalized)) {
    return true;
  }

  // IPv4-mapped IPv6: ::ffff:x.x.x.x (dotted-decimal form)
  const v4MappedMatch = normalized.match(
    /^(?:::ffff:|0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:ffff:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/,
  );
  if (v4MappedMatch) {
    const v4 = parseIPv4(v4MappedMatch[1]);
    if (v4 !== null && isBlockedIPv4(v4)) {
      return true;
    }
  }

  // IPv4-mapped IPv6 in hex form: ::ffff:7f00:1 (URL parser normalizes to this)
  const v4MappedHexMatch = normalized.match(
    /^(?:::ffff:|0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/,
  );
  if (v4MappedHexMatch) {
    const high = Number.parseInt(v4MappedHexMatch[1], 16);
    const low = Number.parseInt(v4MappedHexMatch[2], 16);
    const v4 = ((high << 16) | low) >>> 0;
    if (isBlockedIPv4(v4)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a hostname is a bracketed IPv6 literal like [::1].
 * Returns the inner address or null.
 */
function extractIPv6FromBrackets(hostname: string): string | null {
  const match = hostname.match(/^\[(.+)\]$/);
  return match ? match[1] : null;
}

/**
 * Validate that a URL hostname is safe to fetch. Returns a FetchError if
 * blocked, or null if the URL is safe.
 *
 * Checks:
 * 1. IPv4 literals against private/reserved ranges
 * 2. IPv6 literals against loopback/link-local/ULA
 * 3. Known cloud metadata hostnames
 * 4. Numeric-only hostnames (decimal IP encodings)
 */
export function validateUrlSafety(
  url: string,
  context: { phase: "validation" | "loading"; label?: string } = {
    phase: "validation",
  },
): FetchError | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      error: `Invalid URL: ${url}`,
      code: "invalid_url",
      phase: "validation",
      retryable: false,
      url,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Check blocked hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return buildBlockedError(url, hostname, context);
  }

  // Check IPv6 literals [::1] etc.
  const ipv6 = extractIPv6FromBrackets(hostname);
  if (ipv6 !== null) {
    if (isBlockedIPv6(ipv6)) {
      return buildBlockedError(url, hostname, context);
    }
    return null;
  }

  // Check IPv4 literals
  const ipv4 = parseIPv4(hostname);
  if (ipv4 !== null) {
    if (isBlockedIPv4(ipv4)) {
      return buildBlockedError(url, hostname, context);
    }
    return null;
  }

  // Block numeric-encoded IPs (decimal: http://2130706433 = 127.0.0.1)
  if (/^\d+$/.test(hostname)) {
    const numericIp = Number.parseInt(hostname, 10);
    if (Number.isFinite(numericIp) && numericIp >= 0 && numericIp <= 0xffffffff) {
      if (isBlockedIPv4(numericIp >>> 0)) {
        return buildBlockedError(url, hostname, context);
      }
    }
  }

  // Block well-known localhost aliases
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return buildBlockedError(url, hostname, context);
  }

  return null;
}

function buildBlockedError(
  url: string,
  hostname: string,
  context: { phase: "validation" | "loading"; label?: string },
): FetchError {
  const label = context.label ?? "URL";
  return {
    error: `Blocked request to private/internal address: ${hostname}. ${label} must point to a public internet host.`,
    code: "invalid_url",
    phase: context.phase,
    retryable: false,
    url,
  };
}

/**
 * Headers that should never be forwarded to arbitrary remote servers.
 * These could leak credentials or enable request smuggling if an LLM
 * agent is tricked into setting them.
 */
const BLOCKED_HEADER_NAMES = new Set([
  "host",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "proxy-authorization",
  "proxy-connection",
  "connection",
  "keep-alive",
  "via",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
]);

/**
 * Filter user-supplied headers, removing hop-by-hop and dangerous headers.
 * Returns a new object with only safe headers.
 */
export function filterUnsafeHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;

  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (BLOCKED_HEADER_NAMES.has(lower)) continue;
    // Reject headers with CRLF to prevent header injection
    if (/[\r\n]/.test(key) || /[\r\n]/.test(value)) continue;
    filtered[key] = value;
  }

  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

/**
 * Strip credentials (user:pass@) from a URL string for safe logging.
 */
export function sanitizeUrlForLogging(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = "";
      parsed.password = "";
      return parsed.toString();
    }
    return url;
  } catch {
    // If not a valid URL, strip anything between :// and @
    return url.replace(/:\/\/[^@]+@/, "://***@");
  }
}
