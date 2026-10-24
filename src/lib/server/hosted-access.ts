import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

const PROVIDER_KEYS = {
  gemini: { headers: ["X-Gemini-API-Key"], env: "GEMINI_API_KEY" },
  openai: { headers: ["X-OpenAI-API-Key"], env: "OPENAI_API_KEY" },
  anthropic: { headers: ["X-Anthropic-API-Key"], env: "ANTHROPIC_API_KEY" },
  replicate: { headers: ["X-Replicate-API-Key", "X-Replicate-Key", "X-API-Key"], env: "REPLICATE_API_KEY" },
  fal: { headers: ["X-Fal-API-Key", "X-Fal-Key", "X-API-Key"], env: "FAL_API_KEY" },
  kie: { headers: ["X-Kie-Key"], env: "KIE_API_KEY" },
  wavespeed: { headers: ["X-WaveSpeed-Key"], env: "WAVESPEED_API_KEY" },
} as const;

export type ProviderKeyName = keyof typeof PROVIDER_KEYS;

export interface HostedConfig {
  enabled: boolean;
  credentialsConfigured: boolean;
  trustProxyTls: boolean;
  allowInsecureLocal: boolean;
}

export interface HostedRequestOptions {
  secureTransport?: boolean;
}

const AUTH_REALM = 'Basic realm="Kivo Hosted", charset="UTF-8"';
const MAX_USERNAME_LENGTH = 512;
const MAX_PASSWORD_LENGTH = 4096;

export function getHostedConfig(): HostedConfig {
  const username = process.env.KIVO_AUTH_USERNAME;
  const password = process.env.KIVO_AUTH_PASSWORD;
  const credentialsConfigured = Boolean(
    username && password &&
    username.length <= MAX_USERNAME_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH &&
    !username.includes(":")
  );

  return {
    enabled: process.env.KIVO_HOSTED === "true",
    credentialsConfigured,
    trustProxyTls: process.env.KIVO_TRUST_PROXY_TLS === "true",
    allowInsecureLocal: process.env.KIVO_ALLOW_INSECURE_HOSTED_LOCAL === "true",
  };
}

export function isHostedMode(): boolean {
  return getHostedConfig().enabled;
}

export function resolveProviderApiKey(
  request: Pick<Request, "headers">,
  provider: ProviderKeyName
): string | null {
  const providerConfig = PROVIDER_KEYS[provider];
  for (const headerName of providerConfig.headers) {
    const key = request.headers.get(headerName)?.trim();
    if (key) return key;
  }

  if (isHostedMode()) return null;
  const environmentKey = process.env[providerConfig.env]?.trim();
  return environmentKey || null;
}

export function checkHostedRequest(
  request: Pick<Request, "headers" | "url">,
  options: HostedRequestOptions = {}
): NextResponse | null {
  const config = getHostedConfig();
  if (!config.enabled) return null;
  if (!config.credentialsConfigured) {
    return accessError(503, "Hosted access is not configured.");
  }
  if (!isSecureTransport(request, config, options)) {
    return accessError(426, "HTTPS is required for hosted access.");
  }
  if (!hasValidBasicAuth(request.headers.get("authorization"))) {
    return accessError(401, "Authentication required.", { "WWW-Authenticate": AUTH_REALM });
  }
  return null;
}

export function checkHostedCsrf(request: Pick<Request, "headers" | "method" | "url">): NextResponse | null {
  if (!isHostedMode() || !isMutatingMethod(request.method)) return null;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    return accessError(403, "Cross-origin requests are not allowed.");
  }

  const origin = request.headers.get("origin");
  if (!origin || !isSameOrigin(origin, expectedOrigin(request))) {
    return accessError(403, "A same-origin request is required.");
  }
  return null;
}

export function takeHostedProxyRateLimit(now = Date.now()): number | null {
  return takeRateLimit("hosted-proxy", 300, 60_000, now);
}

export function hostedRateLimitResponse(retryAfterSeconds: number): NextResponse {
  return accessError(429, "Too many requests. Please try again shortly.", {
    "Retry-After": String(retryAfterSeconds),
  });
}

function hasValidBasicAuth(header: string | null): boolean {
  if (!header) return false;
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(header);
  if (!match || match[1].length % 4 !== 0) return false;

  const bytes = Buffer.from(match[1], "base64");
  if (bytes.toString("base64") !== match[1]) return false;

  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }

  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  const configuredUsername = process.env.KIVO_AUTH_USERNAME ?? "";
  const configuredPassword = process.env.KIVO_AUTH_PASSWORD ?? "";
  const usernameMatches = secureStringEqual(username, configuredUsername);
  const passwordMatches = secureStringEqual(password, configuredPassword);
  return usernameMatches && passwordMatches;
}

function secureStringEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left, "utf8").digest();
  const rightHash = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftHash, rightHash);
}

function isSecureTransport(
  request: Pick<Request, "headers" | "url">,
  config: HostedConfig,
  options: HostedRequestOptions
): boolean {
  if (options.secureTransport !== undefined) return options.secureTransport;
  const url = new URL(request.url);
  if (config.trustProxyTls) {
    return request.headers.get("x-forwarded-proto")?.trim() === "https" &&
      trustedForwardedOrigin(request) !== null;
  }

  return url.protocol === "http:" && isAllowedLoopbackHttp(url.hostname, config);
}

function isAllowedLoopbackHttp(hostname: string, config: HostedConfig): boolean {
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  return config.allowInsecureLocal && process.env.NODE_ENV !== "production" && localHosts.has(hostname);
}

function isMutatingMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function expectedOrigin(request: Pick<Request, "headers" | "url">): string {
  const config = getHostedConfig();
  if (!config.trustProxyTls) return new URL(request.url).origin;
  return trustedForwardedOrigin(request) ?? "";
}

function trustedForwardedOrigin(request: Pick<Request, "headers">): string | null {
  if (request.headers.get("x-forwarded-proto")?.trim() !== "https") return null;
  const forwardedHost = request.headers.get("x-forwarded-host")?.trim();
  if (!forwardedHost || forwardedHost.includes(",")) return null;
  try {
    const url = new URL(`https://${forwardedHost}`);
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isSameOrigin(origin: string, expected: string): boolean {
  try {
    return new URL(origin).origin === expected;
  } catch {
    return false;
  }
}

function takeRateLimit(bucket: string, maxRequests: number, windowMs: number, now: number): number | null {
  const globalState = globalThis as typeof globalThis & {
    __kivoHostedAccessLimits?: Map<string, { resetAt: number; count: number }>;
  };
  const limits = globalState.__kivoHostedAccessLimits ??= new Map();
  const current = limits.get(bucket);
  if (!current || current.resetAt <= now) {
    limits.set(bucket, { resetAt: now + windowMs, count: 1 });
    return null;
  }

  current.count += 1;
  return current.count > maxRequests ? Math.max(1, Math.ceil((current.resetAt - now) / 1000)) : null;
}

function accessError(
  status: number,
  message: string,
  headers: Record<string, string> = {}
): NextResponse {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}
