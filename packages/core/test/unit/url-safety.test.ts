import { describe, expect, it } from "bun:test";
import {
  filterUnsafeHeaders,
  sanitizeUrlForLogging,
  validateUrlSafety,
} from "../../src/url-safety";

describe("validateUrlSafety", () => {
  describe("allows public internet URLs", () => {
    const safeUrls = [
      "https://example.com",
      "https://www.google.com/search?q=test",
      "http://httpbin.org/html",
      "https://1.1.1.1",
      "https://8.8.8.8",
      "https://203.0.114.1", // just outside TEST-NET-3
    ];

    for (const url of safeUrls) {
      it(`allows ${url}`, () => {
        expect(validateUrlSafety(url)).toBeNull();
      });
    }
  });

  describe("blocks loopback addresses", () => {
    const blocked = [
      "http://127.0.0.1",
      "http://127.0.0.1:8080/admin",
      "http://127.255.255.254",
      "http://localhost",
      "http://localhost:3000",
      "http://sub.localhost",
      "http://[::1]",
    ];

    for (const url of blocked) {
      it(`blocks ${url}`, () => {
        const result = validateUrlSafety(url);
        expect(result).not.toBeNull();
        expect(result!.code).toBe("invalid_url");
        expect(result!.error).toContain("private/internal");
      });
    }
  });

  describe("blocks RFC 1918 private ranges", () => {
    const blocked = [
      "http://10.0.0.1",
      "http://10.255.255.255",
      "http://172.16.0.1",
      "http://172.31.255.255",
      "http://192.168.0.1",
      "http://192.168.1.100:8080",
    ];

    for (const url of blocked) {
      it(`blocks ${url}`, () => {
        const result = validateUrlSafety(url);
        expect(result).not.toBeNull();
        expect(result!.code).toBe("invalid_url");
      });
    }

    it("allows 172.32.0.1 (outside 172.16/12 range)", () => {
      expect(validateUrlSafety("http://172.32.0.1")).toBeNull();
    });
  });

  describe("blocks cloud metadata endpoints", () => {
    it("blocks 169.254.169.254 (AWS/Azure/GCP metadata)", () => {
      const result = validateUrlSafety("http://169.254.169.254/latest/meta-data/");
      expect(result).not.toBeNull();
      expect(result!.code).toBe("invalid_url");
    });

    it("blocks metadata.google.internal", () => {
      const result = validateUrlSafety(
        "http://metadata.google.internal/computeMetadata/v1/",
      );
      expect(result).not.toBeNull();
    });

    it("blocks metadata.goog", () => {
      const result = validateUrlSafety("http://metadata.goog/");
      expect(result).not.toBeNull();
    });
  });

  describe("blocks IPv6 private addresses", () => {
    const blocked = [
      "http://[::1]",
      "http://[fe80::1]",
      "http://[fd00::1]",
      "http://[fc00::1]",
      "http://[fec0::1]",
    ];

    for (const url of blocked) {
      it(`blocks ${url}`, () => {
        const result = validateUrlSafety(url);
        expect(result).not.toBeNull();
        expect(result!.code).toBe("invalid_url");
      });
    }
  });

  describe("blocks IPv4-mapped IPv6 private addresses", () => {
    it("blocks ::ffff:127.0.0.1", () => {
      const result = validateUrlSafety("http://[::ffff:127.0.0.1]");
      expect(result).not.toBeNull();
    });

    it("blocks ::ffff:10.0.0.1", () => {
      const result = validateUrlSafety("http://[::ffff:10.0.0.1]");
      expect(result).not.toBeNull();
    });

    it("blocks ::ffff:169.254.169.254", () => {
      const result = validateUrlSafety("http://[::ffff:169.254.169.254]");
      expect(result).not.toBeNull();
    });
  });

  describe("blocks numeric IP encoding", () => {
    it("blocks decimal-encoded 127.0.0.1 (2130706433)", () => {
      const result = validateUrlSafety("http://2130706433");
      expect(result).not.toBeNull();
    });

    it("blocks decimal-encoded 10.0.0.1 (167772161)", () => {
      const result = validateUrlSafety("http://167772161");
      expect(result).not.toBeNull();
    });
  });

  describe("blocks 0.0.0.0/8 range", () => {
    it("blocks http://0.0.0.0", () => {
      const result = validateUrlSafety("http://0.0.0.0");
      expect(result).not.toBeNull();
    });
  });

  describe("blocks multicast and reserved ranges", () => {
    it("blocks 224.0.0.1 (multicast)", () => {
      const result = validateUrlSafety("http://224.0.0.1");
      expect(result).not.toBeNull();
    });

    it("blocks 240.0.0.1 (reserved)", () => {
      const result = validateUrlSafety("http://240.0.0.1");
      expect(result).not.toBeNull();
    });

    it("blocks 255.255.255.255 (broadcast)", () => {
      const result = validateUrlSafety("http://255.255.255.255");
      expect(result).not.toBeNull();
    });
  });

  describe("blocks CGNAT and test ranges", () => {
    it("blocks 100.64.0.1 (CGNAT / RFC 6598)", () => {
      const result = validateUrlSafety("http://100.64.0.1");
      expect(result).not.toBeNull();
    });

    it("blocks 100.127.255.254 (CGNAT upper bound)", () => {
      const result = validateUrlSafety("http://100.127.255.254");
      expect(result).not.toBeNull();
    });

    it("allows 100.128.0.1 (outside CGNAT range)", () => {
      expect(validateUrlSafety("http://100.128.0.1")).toBeNull();
    });

    it("blocks 192.0.2.1 (TEST-NET-1)", () => {
      const result = validateUrlSafety("http://192.0.2.1");
      expect(result).not.toBeNull();
    });

    it("blocks 198.51.100.1 (TEST-NET-2)", () => {
      const result = validateUrlSafety("http://198.51.100.1");
      expect(result).not.toBeNull();
    });

    it("blocks 203.0.113.1 (TEST-NET-3)", () => {
      const result = validateUrlSafety("http://203.0.113.1");
      expect(result).not.toBeNull();
    });

    it("blocks 198.18.0.1 (benchmarking)", () => {
      const result = validateUrlSafety("http://198.18.0.1");
      expect(result).not.toBeNull();
    });
  });

  describe("blocks fec0::/10 full range (deprecated site-local)", () => {
    const blocked = [
      "http://[fec0::1]",
      "http://[fed0::1]",
      "http://[fee0::1]",
      "http://[fef0::1]",
    ];

    for (const url of blocked) {
      it(`blocks ${url}`, () => {
        const result = validateUrlSafety(url);
        expect(result).not.toBeNull();
        expect(result!.code).toBe("invalid_url");
      });
    }
  });

  describe("blocks unspecified IPv6 address", () => {
    it("blocks http://[::]", () => {
      const result = validateUrlSafety("http://[::]");
      expect(result).not.toBeNull();
    });
  });

  describe("handles URL parser normalization (octal/hex IPs)", () => {
    it("blocks octal-encoded 127.0.0.1 (0177.0.0.1)", () => {
      // URL parser normalizes 0177.0.0.1 → 127.0.0.1
      const result = validateUrlSafety("http://0177.0.0.1");
      expect(result).not.toBeNull();
    });

    it("blocks hex-encoded 127.0.0.1 (0x7f000001)", () => {
      // URL parser normalizes 0x7f000001 → 127.0.0.1
      const result = validateUrlSafety("http://0x7f000001");
      expect(result).not.toBeNull();
    });

    it("blocks percent-encoded 127.0.0.1", () => {
      // URL parser normalizes percent-encoded → 127.0.0.1
      const result = validateUrlSafety("http://%31%32%37%2e%30%2e%30%2e%31");
      expect(result).not.toBeNull();
    });
  });

  describe("blocks Kubernetes internal", () => {
    it("blocks kubernetes.default.svc", () => {
      const result = validateUrlSafety("http://kubernetes.default.svc");
      expect(result).not.toBeNull();
    });

    it("blocks kubernetes.default (without .svc)", () => {
      const result = validateUrlSafety("http://kubernetes.default");
      expect(result).not.toBeNull();
    });
  });

  it("supports phase context in error", () => {
    const result = validateUrlSafety("http://127.0.0.1", {
      phase: "loading",
      label: "Redirect target",
    });
    expect(result).not.toBeNull();
    expect(result!.phase).toBe("loading");
    expect(result!.error).toContain("Redirect target");
  });

  it("returns null for invalid URL passed as SSRF check", () => {
    const result = validateUrlSafety("not-a-url");
    expect(result).not.toBeNull();
    expect(result!.code).toBe("invalid_url");
  });
});

describe("filterUnsafeHeaders", () => {
  it("returns undefined for undefined input", () => {
    expect(filterUnsafeHeaders(undefined)).toBeUndefined();
  });

  it("passes through safe custom headers", () => {
    const headers = {
      Authorization: "Bearer token123",
      "X-Custom": "value",
      Cookie: "session=abc",
    };
    const result = filterUnsafeHeaders(headers);
    expect(result).toEqual({
      Authorization: "Bearer token123",
      "X-Custom": "value",
      Cookie: "session=abc",
    });
  });

  it("strips Host header", () => {
    const headers = { Host: "evil.com", Accept: "text/html" };
    const result = filterUnsafeHeaders(headers);
    expect(result).toEqual({ Accept: "text/html" });
  });

  it("strips hop-by-hop headers (case-insensitive)", () => {
    const headers = {
      "Transfer-Encoding": "chunked",
      Connection: "keep-alive",
      "Keep-Alive": "timeout=5",
      "X-Custom": "ok",
    };
    const result = filterUnsafeHeaders(headers);
    expect(result).toEqual({ "X-Custom": "ok" });
  });

  it("strips proxy-related headers", () => {
    const headers = {
      "Proxy-Authorization": "Basic abc",
      "Proxy-Connection": "keep-alive",
      "X-Custom": "ok",
    };
    const result = filterUnsafeHeaders(headers);
    expect(result).toEqual({ "X-Custom": "ok" });
  });

  it("strips forwarding headers to prevent spoofing", () => {
    const headers = {
      Forwarded: "for=1.2.3.4",
      "X-Forwarded-For": "1.2.3.4",
      "X-Forwarded-Host": "evil.com",
      "X-Forwarded-Proto": "https",
      "X-Real-IP": "1.2.3.4",
      Via: "1.1 proxy.internal",
      "User-Agent": "MyBot",
    };
    const result = filterUnsafeHeaders(headers);
    expect(result).toEqual({ "User-Agent": "MyBot" });
  });

  it("returns undefined for empty headers object", () => {
    expect(filterUnsafeHeaders({})).toBeUndefined();
  });

  it("rejects headers with CRLF in name (header injection)", () => {
    const headers = { "X-Bad\r\nInjected": "value", "X-Good": "ok" };
    const result = filterUnsafeHeaders(headers);
    expect(result).toEqual({ "X-Good": "ok" });
  });

  it("rejects headers with CRLF in value (header injection)", () => {
    const headers = {
      "X-Bad": "value\r\nInjected: evil",
      "X-Good": "ok",
    };
    const result = filterUnsafeHeaders(headers);
    expect(result).toEqual({ "X-Good": "ok" });
  });

  it("returns undefined when all headers are blocked", () => {
    const headers = { Host: "evil.com", Connection: "close" };
    expect(filterUnsafeHeaders(headers)).toBeUndefined();
  });
});

describe("sanitizeUrlForLogging", () => {
  it("returns URL unchanged when no credentials", () => {
    expect(sanitizeUrlForLogging("https://example.com/path")).toBe(
      "https://example.com/path",
    );
  });

  it("strips username and password from URL", () => {
    const result = sanitizeUrlForLogging("http://user:pass@proxy.internal:8080");
    expect(result).not.toContain("user");
    expect(result).not.toContain("pass");
    expect(result).toContain("proxy.internal:8080");
  });

  it("strips credentials from socks5 proxy URLs", () => {
    const result = sanitizeUrlForLogging("socks5://admin:secret@10.0.0.1:1080");
    expect(result).not.toContain("admin");
    expect(result).not.toContain("secret");
  });

  it("handles malformed URLs gracefully", () => {
    const result = sanitizeUrlForLogging("not://user:pass@a-url");
    expect(result).not.toContain("pass");
  });
});
