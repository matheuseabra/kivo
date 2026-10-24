import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";

const originalEnv = { ...process.env };
const originalFetch = global.fetch;
const mockFetch = vi.fn();
const appAuthorization = `Basic ${Buffer.from("owner:secret").toString("base64")}`;

function hostedRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://kivo.internal/api/providers/fal/models", {
    headers: {
      Authorization: appAuthorization,
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Host": "kivo.test",
      ...headers,
    },
  });
}

describe("/api/providers/fal/models hosted credentials", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      KIVO_HOSTED: "true",
      KIVO_AUTH_USERNAME: "owner",
      KIVO_AUTH_PASSWORD: "secret",
      KIVO_TRUST_PROXY_TLS: "true",
      FAL_API_KEY: "operator-fal-key",
    };
    mockFetch.mockReset();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it("forwards the provider header and never forwards Basic app credentials", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ models: [], next_cursor: null, has_more: false }),
    });

    const response = await GET(hostedRequest({ "X-API-Key": "user-fal-key" }));

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.fal.ai/v1/models?status=active",
      { headers: { Authorization: "Key user-fal-key" } }
    );
    expect(JSON.stringify(mockFetch.mock.calls)).not.toContain(appAuthorization);
    await response.json();
  });

  it("requires a provider key instead of using Basic auth or the operator key", async () => {
    const response = await GET(hostedRequest());

    expect(response.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
    await response.json();
  });
});
