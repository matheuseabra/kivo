import { NextRequest, NextResponse } from "next/server";
import {
  checkHostedCsrf,
  checkHostedRequest,
  hostedRateLimitResponse,
  isHostedMode,
} from "./hosted-access";

export interface ApiRequestGuardOptions {
  bucket: string;
  maxRequests: number;
  windowMs: number;
  maxConcurrent: number;
  bodyLimitBytes?: number;
}

interface GuardBucket {
  resetAt: number;
  count: number;
}

interface GuardState {
  rates: Map<string, GuardBucket>;
  active: Map<string, number>;
}

const SERVICE_BUSY_STATUS = 503;

export async function withApiRequestGuard<T extends Request>(
  request: T,
  options: ApiRequestGuardOptions,
  handler: (request: T) => Promise<Response>
): Promise<Response> {
  if (!isHostedMode()) return handler(request);

  const authResponse = checkHostedRequest(request);
  if (authResponse) return authResponse;
  const csrfResponse = checkHostedCsrf(request);
  if (csrfResponse) return csrfResponse;

  const retryAfter = takeRateLimit(options);
  if (retryAfter !== null) return hostedRateLimitResponse(retryAfter);

  const release = acquireSlot(options.bucket, options.maxConcurrent);
  if (!release) return busyResponse();

  let boundedRequest: T | Response;
  try {
    boundedRequest = options.bodyLimitBytes
      ? await cloneBoundedRequest(request, options.bodyLimitBytes)
      : request;
  } catch {
    release();
    return NextResponse.json({ error: "The request body could not be read." }, { status: 400 });
  }
  if (boundedRequest instanceof Response) {
    release();
    return boundedRequest;
  }

  try {
    const response = await handler(boundedRequest as T);
    return holdSlotUntilResponseEnds(response, release);
  } catch (error) {
    release();
    throw error;
  }
}

function takeRateLimit(options: ApiRequestGuardOptions, now = Date.now()): number | null {
  const bucketKey = `api:${options.bucket}`;
  const rates = getGuardState().rates;
  const current = rates.get(bucketKey);
  if (!current || current.resetAt <= now) {
    rates.set(bucketKey, { resetAt: now + options.windowMs, count: 1 });
    return null;
  }

  current.count += 1;
  return current.count > options.maxRequests ? Math.max(1, Math.ceil((current.resetAt - now) / 1000)) : null;
}

function acquireSlot(bucket: string, maxConcurrent: number): (() => void) | null {
  const active = getGuardState().active;
  const current = active.get(bucket) ?? 0;
  if (current >= maxConcurrent) return null;
  active.set(bucket, current + 1);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (active.get(bucket) ?? 1) - 1;
    if (remaining === 0) active.delete(bucket);
    else active.set(bucket, remaining);
  };
}

async function cloneBoundedRequest<T extends Request>(request: T, maxBytes: number): Promise<T | Response> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return payloadTooLargeResponse(maxBytes);
  }
  if (!request.body) return request;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        return payloadTooLargeResponse(maxBytes);
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel();
    throw new Error("Request body stream failed.");
  }

  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return new NextRequest(request.url, {
    method: request.method,
    headers: request.headers,
    body,
    signal: request.signal,
  }) as unknown as T;
}

function holdSlotUntilResponseEnds(response: Response, release: () => void): Response {
  if (!response.body) {
    release();
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          controller.close();
          release();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        controller.error(error);
        release();
      }
    },
    async cancel(reason) {
      release();
      await reader.cancel(reason);
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function payloadTooLargeResponse(maxBytes: number): NextResponse {
  return NextResponse.json(
    { error: `Request body exceeds the ${maxBytes}-byte limit.` },
    { status: 413 }
  );
}

function busyResponse(): NextResponse {
  return NextResponse.json(
    { error: "The hosted service is busy. Please try again shortly." },
    { status: SERVICE_BUSY_STATUS, headers: { "Retry-After": "10" } }
  );
}

function getGuardState(): GuardState {
  const globalState = globalThis as typeof globalThis & { __kivoApiRequestGuards?: GuardState };
  return globalState.__kivoApiRequestGuards ??= {
    rates: new Map<string, GuardBucket>(),
    active: new Map<string, number>(),
  };
}
