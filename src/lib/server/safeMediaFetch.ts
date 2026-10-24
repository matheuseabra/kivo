import { lookup as dnsLookup } from "node:dns/promises";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import { getIpAddressFamily, isPublicIpAddress, validateMediaUrl, validateResolvedMediaAddresses } from "@/utils/urlValidation";

export type SafeMediaKind = "image" | "video" | "audio" | "model" | "media";

export interface SafeMediaFetchOptions {
  kind: SafeMediaKind;
  fallbackKind?: SafeMediaKind;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

export interface SafeMediaFetchResult {
  buffer: Buffer;
  contentType: string;
  finalUrl: string;
  status: number;
}

export interface ResolvedMediaAddress {
  address: string;
  family: 4 | 6;
}

interface SafeResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  dispose?: () => void;
}

type Resolver = (hostname: string) => Promise<ResolvedMediaAddress[]>;
type Requester = (url: URL, address: ResolvedMediaAddress, signal: AbortSignal) => Promise<SafeResponse>;

interface TestDependencies {
  resolveHost?: Resolver;
  request?: Requester;
}

type NormalizedOptions = Omit<Required<SafeMediaFetchOptions>, "fallbackKind"> & Pick<SafeMediaFetchOptions, "fallbackKind">;

const MIME_TYPES: Record<SafeMediaKind, Set<string>> = {
  image: new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/avif", "image/bmp", "image/heic"]),
  video: new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/mpeg", "video/3gpp"]),
  audio: new Set(["audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg", "audio/flac", "audio/aac", "audio/mp4", "audio/webm", "audio/opus"]),
  model: new Set(["model/gltf-binary", "model/gltf+json", "model/obj", "model/fbx", "model/stl", "model/vnd.usdz+zip", "application/octet-stream"]),
  media: new Set([
    "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/avif", "image/bmp", "image/heic",
    "video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/mpeg", "video/3gpp",
    "audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg", "audio/flac", "audio/aac", "audio/mp4", "audio/webm", "audio/opus",
  ]),
};

const FALLBACK_MIME: Partial<Record<SafeMediaKind, string>> = {
  image: "image/png",
  video: "video/mp4",
  audio: "audio/mpeg",
  model: "model/gltf-binary",
};

function bareContentType(value: string | undefined): string {
  return (value || "").split(";", 1)[0].trim().toLowerCase();
}

function resolveContentType(value: string | undefined, kind: SafeMediaKind, fallbackKind?: SafeMediaKind): string {
  const normalized = bareContentType(value);
  const accepted = MIME_TYPES[kind];
  if (!normalized || normalized === "application/octet-stream") {
    if (kind === "model" && normalized) return normalized;
    const fallback = FALLBACK_MIME[kind] || (fallbackKind ? FALLBACK_MIME[fallbackKind] : undefined);
    if (fallback) return fallback;
    throw new Error(`Unsupported media content type: ${normalized || "missing"}`);
  }
  if (!accepted.has(normalized)) throw new Error(`Unsupported media content type: ${normalized || "missing"}`);
  return normalized;
}

function normalizedHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

async function systemResolve(hostname: string): Promise<ResolvedMediaAddress[]> {
  const family = getIpAddressFamily(hostname);
  if (family) return [{ address: hostname, family }];
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({ address: record.address, family: record.family as 4 | 6 }));
}

export function getFallbackMediaKind(capabilities: string[]): SafeMediaKind | undefined {
  if (capabilities.some((capability) => capability.includes("audio"))) return "audio";
  if (capabilities.some((capability) => capability.includes("video"))) return "video";
  if (capabilities.some((capability) => capability.includes("image"))) return "image";
  return undefined;
}

export function createPinnedLookup(address: ResolvedMediaAddress): typeof dns.lookup {
  return ((_hostname: string, options: { all?: boolean }, callback: (error: NodeJS.ErrnoException | null, result: string | Array<{ address: string; family: number }>, family?: number) => void) => {
    if (options?.all) callback(null, [{ address: address.address, family: address.family }]);
    else callback(null, address.address, address.family);
  }) as typeof dns.lookup;
}

function requestPinned(url: URL, address: ResolvedMediaAddress, signal: AbortSignal): Promise<SafeResponse> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const lookup = createPinnedLookup(address);
    const agent = new (url.protocol === "https:" ? https.Agent : http.Agent)({ keepAlive: false, lookup });
    let incoming: IncomingMessage | undefined;
    const abort = () => {
      request.destroy(new Error("Media download aborted"));
      incoming?.destroy();
    };
    const request = transport.request(url, {
      method: "GET",
      agent,
      headers: { accept: "image/*, video/*, audio/*, model/*, application/octet-stream", "accept-encoding": "identity" },
    }, (response: IncomingMessage) => {
      incoming = response;
      const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value]));
      resolve({
        status: response.statusCode || 0,
        headers,
        body: response,
        dispose: () => {
          signal.removeEventListener("abort", abort);
          response.destroy();
          agent.destroy();
        },
      });
    });
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    request.on("error", (error) => {
      signal.removeEventListener("abort", abort);
      agent.destroy();
      reject(error);
    });
    request.end();
  });
}

function getRedirectUrl(response: SafeResponse, current: URL): URL | null {
  if (![301, 302, 303, 307, 308].includes(response.status)) return null;
  const location = response.headers.location;
  response.dispose?.();
  if (!location) throw new Error("Media redirect did not include a location");
  return new URL(location, current);
}

async function readBoundedBody(response: SafeResponse, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`Media exceeds the ${maxBytes} byte limit`);
  for await (const value of response.body) {
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) throw new Error(`Media exceeds the ${maxBytes} byte limit`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

async function fetchRedirectChain(
  source: string,
  options: NormalizedOptions,
  signal: AbortSignal,
  dependencies: TestDependencies
): Promise<SafeMediaFetchResult> {
  let current = new URL(source);
  for (let redirects = 0; redirects <= options.maxRedirects; redirects += 1) {
    const response = await requestMediaHop(current, signal, dependencies);
    if (response.redirect) {
      if (redirects === options.maxRedirects) throw new Error("Too many media redirects");
      current = response.redirect;
      continue;
    }
    return finishMediaResponse(response, current, options);
  }
  throw new Error("Too many media redirects");
}

async function requestMediaHop(
  current: URL,
  signal: AbortSignal,
  dependencies: TestDependencies
): Promise<(SafeResponse & { redirect?: never }) | { redirect: URL }> {
  const validation = validateMediaUrl(current.href);
  if (!validation.valid) throw new Error(validation.error || "Invalid media URL");
  const resolved = await (dependencies.resolveHost || systemResolve)(normalizedHostname(current));
  const addressValidation = validateResolvedMediaAddresses(resolved);
  if (!addressValidation.valid) throw new Error(addressValidation.error || "Blocked media destination");
  if (signal.aborted) throw new Error("Media download timed out");
  const response = await (dependencies.request || requestPinned)(current, resolved[0], signal);
  const redirect = getRedirectUrl(response, current);
  return redirect ? { redirect } : response;
}

async function finishMediaResponse(
  response: SafeResponse,
  current: URL,
  options: NormalizedOptions
): Promise<SafeMediaFetchResult> {
  if (response.status < 200 || response.status >= 300) {
    response.dispose?.();
    throw new Error(`Media download failed with status ${response.status}`);
  }
  try {
    const contentType = resolveContentType(response.headers["content-type"], options.kind, options.fallbackKind);
    const buffer = await readBoundedBody(response, options.maxBytes);
    return { buffer, contentType, finalUrl: current.href, status: response.status };
  } finally {
    response.dispose?.();
  }
}

function validateMediaLimits(options: NormalizedOptions): void {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) throw new Error("Invalid media size limit");
  if (!Number.isSafeInteger(options.maxRedirects) || options.maxRedirects < 0) throw new Error("Invalid redirect limit");
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) throw new Error("Invalid media timeout");
}

function normalizeOptions(options: SafeMediaFetchOptions): NormalizedOptions {
  const normalized: NormalizedOptions = {
    kind: options.kind,
    fallbackKind: options.fallbackKind,
    maxBytes: options.maxBytes ?? 100 * 1024 * 1024,
    timeoutMs: options.timeoutMs ?? 60_000,
    maxRedirects: options.maxRedirects ?? 3,
  };
  if (!MIME_TYPES[normalized.kind]) throw new Error("Invalid media kind");
  if (normalized.fallbackKind && !FALLBACK_MIME[normalized.fallbackKind]) throw new Error("Invalid fallback media kind");
  validateMediaLimits(normalized);
  return normalized;
}

async function fetchWithDeadline(
  source: string,
  options: NormalizedOptions,
  dependencies: TestDependencies
): Promise<SafeMediaFetchResult> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const operation = fetchRedirectChain(source, options, controller.signal, dependencies);
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(`Media download timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);
  });
  try {
    return await Promise.race([operation, timedOut]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function safeFetchMedia(
  source: string,
  options: SafeMediaFetchOptions,
  dependencies: TestDependencies = {}
): Promise<SafeMediaFetchResult> {
  const parsed = validateMediaUrl(source);
  if (!parsed.valid) throw new Error(parsed.error || "Invalid media URL");
  return fetchWithDeadline(source, normalizeOptions(options), dependencies);
}
