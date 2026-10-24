import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkHostedCsrf,
  checkHostedRequest,
  getHostedConfig,
  resolveProviderApiKey,
} from "../hosted-access";

const originalEnv = { ...process.env };
const validAuthorization = `Basic ${Buffer.from("owner:secret").toString("base64")}`;

function request(url = "https://kivo.test/api/example", headers: Record<string, string> = {}) {
  return new Request(url, {
    headers: {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "kivo.test",
      ...headers,
    },
  });
}

describe("hosted access", () => {
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

  it("fails closed when hosted credentials are missing", () => {
    delete process.env.KIVO_AUTH_PASSWORD;

    const response = checkHostedRequest(request());

    expect(getHostedConfig().credentialsConfigured).toBe(false);
    expect(response?.status).toBe(503);
  });

  it("rejects missing, malformed, and incorrect Basic authentication", async () => {
    const missing = checkHostedRequest(request());
    const malformed = checkHostedRequest(request("https://kivo.test/", { authorization: "Basic !!!" }));
    const wrong = checkHostedRequest(request("https://kivo.test/", {
      authorization: `Basic ${Buffer.from("owner:wrong").toString("base64")}`,
    }));

    expect(missing?.status).toBe(401);
    expect(missing?.headers.get("www-authenticate")).toContain("Basic realm=");
    expect(malformed?.status).toBe(401);
    expect(wrong?.status).toBe(401);
  });

  it("allows valid Basic authentication through a configured TLS proxy", () => {
    const response = checkHostedRequest(request("https://kivo.test/", { authorization: validAuthorization }));

    expect(response).toBeNull();
  });

  it("only trusts forwarded HTTPS when explicitly configured", () => {
    const forwardedRequest = request("http://kivo.internal/", {
      authorization: validAuthorization,
      "x-forwarded-proto": "https",
      "x-forwarded-host": "kivo.test",
    });

    process.env.KIVO_TRUST_PROXY_TLS = "false";
    expect(checkHostedRequest(forwardedRequest)?.status).toBe(426);
    process.env.KIVO_TRUST_PROXY_TLS = "true";
    expect(checkHostedRequest(forwardedRequest)).toBeNull();
  });

  it("does not treat a reconstructed HTTPS URL as transport proof", () => {
    process.env.KIVO_TRUST_PROXY_TLS = "false";

    expect(checkHostedRequest(request("https://kivo.test/", { authorization: validAuthorization }))?.status).toBe(426);
  });

  it("blocks cross-origin state-changing requests", () => {
    const headers = {
      authorization: validAuthorization,
      origin: "https://attacker.test",
      "sec-fetch-site": "cross-site",
    };

    const post = new Request("https://kivo.test/api/generate", { method: "POST", headers });
    expect(checkHostedCsrf(post)?.status).toBe(403);
  });

  it("does not require hosted access in local mode", () => {
    process.env.KIVO_HOSTED = "false";

    expect(checkHostedRequest(request("http://localhost:3000/"))).toBeNull();
  });

  it("allows the explicit non-production loopback HTTP smoke-test setting", () => {
    process.env.KIVO_ALLOW_INSECURE_HOSTED_LOCAL = "true";
    process.env = { ...process.env, NODE_ENV: "development" };
    process.env.KIVO_TRUST_PROXY_TLS = "false";

    expect(checkHostedRequest(request("http://localhost:3000/", {
      authorization: validAuthorization,
      "x-forwarded-proto": "http",
      "x-forwarded-host": "localhost:3000",
    }))).toBeNull();
  });

  it("requires user keys in hosted mode and retains local environment fallback", () => {
    process.env.GEMINI_API_KEY = "operator-gemini-key";
    process.env.REPLICATE_API_KEY = "operator-replicate-key";
    const noKeys = request();
    const userGeminiKey = request("https://kivo.test/", { "X-Gemini-API-Key": "user-gemini-key" });
    const legacyReplicateAlias = request("https://kivo.test/", { "X-Replicate-Key": "user-replicate-key" });

    expect(resolveProviderApiKey(noKeys, "gemini")).toBeNull();
    expect(resolveProviderApiKey(userGeminiKey, "gemini")).toBe("user-gemini-key");
    expect(resolveProviderApiKey(legacyReplicateAlias, "replicate")).toBe("user-replicate-key");

    process.env.KIVO_HOSTED = "false";
    expect(resolveProviderApiKey(noKeys, "gemini")).toBe("operator-gemini-key");
    expect(resolveProviderApiKey(noKeys, "replicate")).toBe("operator-replicate-key");
  });
});
