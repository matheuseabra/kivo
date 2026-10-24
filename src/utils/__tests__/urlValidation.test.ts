import { describe, expect, it } from "vitest";
import { isPublicIpAddress, validateMediaUrl, validateResolvedMediaAddresses } from "../urlValidation";

describe("validateMediaUrl", () => {
  it("allows public HTTP and HTTPS hostnames and addresses", () => {
    expect(validateMediaUrl("https://example.com/image.png")).toEqual({ valid: true });
    expect(validateMediaUrl("http://93.184.216.34/image.png")).toEqual({ valid: true });
    expect(validateMediaUrl("https://[2606:4700:4700::1111]/image.png")).toEqual({ valid: true });
  });

  it("rejects unsupported protocols and URL credentials", () => {
    expect(validateMediaUrl("file:///etc/passwd").valid).toBe(false);
    expect(validateMediaUrl("ftp://example.com/file").valid).toBe(false);
    expect(validateMediaUrl("https://user:pass@example.com/file")).toEqual({ valid: false, error: "URL credentials are not allowed" });
  });

  it("rejects loopback, private, link-local, shared, reserved and mapped addresses", () => {
    const addresses = [
      "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.31.1.1",
      "192.0.0.8", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.0.0.1",
      "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "fc00::1", "fe80::1", "ff02::1",
      "2001:db8::1", "2001:2::1", "2002::1", "3fff::1",
    ];
    for (const address of addresses) expect(isPublicIpAddress(address), address).toBe(false);
  });

  it("rejects a DNS answer set that contains any non-public address", () => {
    expect(validateResolvedMediaAddresses([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ])).toEqual({ valid: false, error: "Blocked non-public IP: 10.0.0.5" });
    expect(validateResolvedMediaAddresses([])).toEqual({ valid: false, error: "Host did not resolve" });
  });

  it("rejects localhost names and malformed URLs", () => {
    expect(validateMediaUrl("http://localhost:3000/secret").valid).toBe(false);
    expect(validateMediaUrl("http://api.localhost./secret").valid).toBe(false);
    expect(validateMediaUrl("not-a-url")).toEqual({ valid: false, error: "Invalid URL" });
  });
});
