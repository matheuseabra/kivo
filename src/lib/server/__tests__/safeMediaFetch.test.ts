import { describe, expect, it, vi } from "vitest";
import {
  createPinnedLookup,
  safeFetchMedia,
  type ResolvedMediaAddress,
  type SafeMediaFetchOptions,
} from "../safeMediaFetch";

const PUBLIC_V4: ResolvedMediaAddress = { address: "93.184.216.34", family: 4 };
const PUBLIC_V6: ResolvedMediaAddress = { address: "2606:4700:4700::1111", family: 6 };

function fixtureResponse(
  status: number,
  contentType: string,
  chunks: Uint8Array[] = [Buffer.from("safe-media")],
  headers: Record<string, string> = {}
) {
  return {
    status,
    headers: { "content-type": contentType, ...headers },
    body: (async function* () { yield* chunks; })(),
    dispose: vi.fn(),
  };
}

function fetchWithFixture(
  resolver: (hostname: string) => Promise<ResolvedMediaAddress[]>,
  request: (url: URL, address: ResolvedMediaAddress) => ReturnType<typeof fixtureResponse>,
  options: Partial<SafeMediaFetchOptions> = {}
) {
  return safeFetchMedia("https://media.example/output.png", {
    kind: "image",
    ...options,
  }, {
    resolveHost: resolver,
    request: async (url, address) => request(url, address),
  });
}

describe("safeFetchMedia", () => {
  it("pins both Node lookup modes to the validated address", () => {
    const lookup = createPinnedLookup(PUBLIC_V4) as unknown as (
      hostname: string,
      options: { all?: boolean },
      callback: (error: NodeJS.ErrnoException | null, address: string | Array<{ address: string; family: number }>, family?: number) => void
    ) => void;
    lookup("media.example", {}, (error, address, family) => {
      expect(error).toBeNull();
      expect(address).toBe(PUBLIC_V4.address);
      expect(family).toBe(4);
    });
    lookup("media.example", { all: true }, (error, address) => {
      expect(error).toBeNull();
      expect(address).toEqual([{ address: PUBLIC_V4.address, family: 4 }]);
    });
  });

  it("fetches a public IPv4 fixture and pins its resolved address", async () => {
    const request = vi.fn((_url: URL, address: ResolvedMediaAddress) => fixtureResponse(200, "image/png; charset=binary"));
    const result = await fetchWithFixture(async () => [PUBLIC_V4], request);
    expect(result.buffer.toString()).toBe("safe-media");
    expect(result.contentType).toBe("image/png");
    expect(request).toHaveBeenCalledWith(expect.any(URL), PUBLIC_V4);
  });

  it("supports public IPv6 destinations", async () => {
    const request = vi.fn((_url: URL, address: ResolvedMediaAddress) => fixtureResponse(200, "image/webp"));
    const result = await safeFetchMedia("https://[2606:4700:4700::1111]/image.webp", { kind: "image" }, {
      resolveHost: async (hostname) => {
        expect(hostname).toBe("2606:4700:4700::1111");
        return [PUBLIC_V6];
      },
      request: async (url, address) => request(url, address),
    });
    expect(result.contentType).toBe("image/webp");
    expect(request).toHaveBeenCalledWith(expect.any(URL), PUBLIC_V6);
  });

  it("rejects DNS answers containing private or mixed public/private addresses", async () => {
    const request = vi.fn();
    await expect(fetchWithFixture(async () => [{ address: "10.0.0.2", family: 4 }], request)).rejects.toThrow("Blocked non-public IP");
    await expect(fetchWithFixture(async () => [PUBLIC_V4, { address: "169.254.169.254", family: 4 }], request)).rejects.toThrow("Blocked non-public IP");
    expect(request).not.toHaveBeenCalled();
  });

  it("revalidates each redirect before making the next request", async () => {
    const firstResponse = fixtureResponse(302, "text/plain", [], { location: "http://127.0.0.1/latest/meta-data" });
    const request = vi.fn(() => firstResponse);
    await expect(fetchWithFixture(async () => [PUBLIC_V4], request)).rejects.toThrow("Blocked non-public IP");
    expect(request).toHaveBeenCalledTimes(1);
    expect(firstResponse.dispose).toHaveBeenCalledOnce();
  });

  it("resolves and rejects a private hostname introduced by a redirect", async () => {
    const resolver = vi.fn(async (hostname: string): Promise<ResolvedMediaAddress[]> => {
      if (hostname === "media.example") return [PUBLIC_V4];
      return [{ address: "192.168.0.9", family: 4 }];
    });
    const request = vi.fn(() => fixtureResponse(302, "text/plain", [], { location: "https://internal.example/secret" }));
    await expect(fetchWithFixture(resolver, request)).rejects.toThrow("Blocked non-public IP");
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("follows only bounded redirects and accepts the safe final response", async () => {
    const responses = [
      fixtureResponse(302, "text/plain", [], { location: "/next" }),
      fixtureResponse(200, "image/png"),
    ];
    const request = vi.fn(() => responses.shift()!);
    const result = await fetchWithFixture(async () => [PUBLIC_V4], request, { maxRedirects: 1 });
    expect(result.finalUrl).toBe("https://media.example/next");
    expect(request).toHaveBeenCalledTimes(2);
    await expect(fetchWithFixture(async () => [PUBLIC_V4], () => fixtureResponse(302, "text/plain", [], { location: "/again" }), { maxRedirects: 0 })).rejects.toThrow("Too many media redirects");
  });

  it("caps streamed bodies even when content-length is missing", async () => {
    await expect(fetchWithFixture(async () => [PUBLIC_V4], () => fixtureResponse(200, "image/png", [Buffer.alloc(4), Buffer.alloc(4)]), { maxBytes: 7 })).rejects.toThrow("7 byte limit");
    for (const length of ["-1", "not-a-number"]) {
      await expect(fetchWithFixture(
        async () => [PUBLIC_V4],
        () => fixtureResponse(200, "image/png", [Buffer.alloc(4), Buffer.alloc(4)], { "content-length": length }),
        { maxBytes: 7 }
      )).rejects.toThrow("7 byte limit");
    }
  });

  it("times out a stalled request", async () => {
    await expect(safeFetchMedia("https://media.example/output.png", { kind: "image", timeoutMs: 10 }, {
      resolveHost: async () => [PUBLIC_V4],
      request: (_url, _address, signal) => new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    })).rejects.toThrow("Media download timed out after 10ms");
  });

  it("rejects MIME types outside the requested media kind", async () => {
    const htmlResponse = fixtureResponse(200, "text/html");
    await expect(fetchWithFixture(async () => [PUBLIC_V4], () => htmlResponse)).rejects.toThrow("Unsupported media content type: text/html");
    expect(htmlResponse.dispose).toHaveBeenCalledOnce();
    await expect(safeFetchMedia("https://media.example/unknown", { kind: "media" }, {
      resolveHost: async () => [PUBLIC_V4],
      request: async () => fixtureResponse(200, ""),
    })).rejects.toThrow("Unsupported media content type: missing");
    const generic = await safeFetchMedia("https://media.example/expected-image", { kind: "media", fallbackKind: "image" }, {
      resolveHost: async () => [PUBLIC_V4],
      request: async () => fixtureResponse(200, "application/octet-stream"),
    });
    expect(generic.contentType).toBe("image/png");
    await expect(safeFetchMedia("https://media.example/file.mp4", { kind: "video" }, {
      resolveHost: async () => [PUBLIC_V4],
      request: async () => fixtureResponse(200, "image/png"),
    })).rejects.toThrow("Unsupported media content type: image/png");
  });
});
