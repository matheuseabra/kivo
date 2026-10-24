import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const originalEnv = { ...process.env };
const authorization = `Basic ${Buffer.from("owner:secret").toString("base64")}`;

function hostedRequest(path: string, headers: Record<string, string> = {}, method = "GET"): NextRequest {
  return new NextRequest(`http://kivo.internal${path}`, {
    method,
    headers: {
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Host": "kivo.test",
      ...headers,
    },
  });
}

describe("hosted proxy access", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      KIVO_HOSTED: "true",
      KIVO_AUTH_USERNAME: "owner",
      KIVO_AUTH_PASSWORD: "secret",
      KIVO_TRUST_PROXY_TLS: "true",
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("challenges unauthenticated page and API requests", async () => {
    const page = proxy(hostedRequest("/"));
    const api = proxy(hostedRequest("/api/capabilities"));

    expect(page.status).toBe(401);
    expect(api.status).toBe(401);
    expect(page.headers.get("www-authenticate")).toContain("Basic realm=");
  });

  it("allows authenticated pages and same-origin API methods", () => {
    const page = proxy(hostedRequest("/", { Authorization: authorization }));
    const api = proxy(hostedRequest("/api/capabilities", {
      Authorization: authorization,
      Origin: "https://kivo.test",
      "Sec-Fetch-Site": "same-origin",
    }, "POST"));

    expect(page.headers.get("x-middleware-next")).toBe("1");
    expect(api.headers.get("x-middleware-next")).toBe("1");
  });

  it("rejects cross-origin state-changing methods", () => {
    const response = proxy(hostedRequest("/api/generate", {
      Authorization: authorization,
      Origin: "https://attacker.test",
      "Sec-Fetch-Site": "cross-site",
    }, "POST"));

    expect(response.status).toBe(403);
  });
});
