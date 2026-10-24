import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";

const originalEnv = { ...process.env };
const originalFetch = global.fetch;
const mockFetch = vi.fn();
const appAuthorization = `Basic ${Buffer.from("owner:secret").toString("base64")}`;

function hostedRequest(url = "http://kivo.internal/api/providers/replicate/models", headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    headers: {
      Authorization: appAuthorization,
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Host": "kivo.test",
      ...headers,
    },
  });
}

describe("/api/providers/replicate/models hosted credentials", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      KIVO_HOSTED: "true",
      KIVO_AUTH_USERNAME: "owner",
      KIVO_AUTH_PASSWORD: "secret",
      KIVO_TRUST_PROXY_TLS: "true",
      REPLICATE_API_KEY: "operator-replicate-key",
    };
    mockFetch.mockReset();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it("ignores query and operator keys in hosted mode", async () => {
    const response = await GET(hostedRequest(
      "http://kivo.internal/api/providers/replicate/models?api_key=query-key"
    ));

    expect(response.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
    await response.json();
  });

  it("uses a provider header without forwarding the Basic credentials", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ next: null, previous: null, results: [] }),
    });

    const response = await GET(hostedRequest(undefined, { "X-API-Key": "user-replicate-key" }));

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith("https://api.replicate.com/v1/models", {
      headers: { Authorization: "Bearer user-replicate-key" },
    });
    expect(JSON.stringify(mockFetch.mock.calls)).not.toContain(appAuthorization);
    await response.json();
  });
});
