import { afterEach, describe, expect, it, vi } from "vitest";
import { withApiRequestGuard } from "../request-guards";

const originalEnv = { ...process.env };
const authorization = `Basic ${Buffer.from("owner:secret").toString("base64")}`;

afterEach(() => {
  process.env = { ...originalEnv };
});

function hostedPost(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request("https://kivo.test/api/guard", {
    method: "POST",
    headers: {
      authorization,
      "x-forwarded-proto": "https",
      "x-forwarded-host": "kivo.test",
      origin: "https://kivo.test",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body,
    duplex: "half",
  } as RequestInit);
}

describe("hosted API request guards", () => {
  it("limits streamed bytes when Content-Length is absent", async () => {
    process.env.KIVO_HOSTED = "true";
    process.env.KIVO_AUTH_USERNAME = "owner";
    process.env.KIVO_AUTH_PASSWORD = "secret";
    process.env.KIVO_TRUST_PROXY_TLS = "true";
    const handler = vi.fn(async () => new Response("ok"));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("12345"));
        controller.close();
      },
    });

    const response = await withApiRequestGuard(hostedPost(stream), {
      bucket: "stream-size-test",
      maxRequests: 10,
      windowMs: 60_000,
      maxConcurrent: 1,
      bodyLimitBytes: 4,
    }, handler);

    expect(response.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });

  it("holds concurrent slots until a streaming response closes", async () => {
    process.env.KIVO_HOSTED = "true";
    process.env.KIVO_AUTH_USERNAME = "owner";
    process.env.KIVO_AUTH_PASSWORD = "secret";
    process.env.KIVO_TRUST_PROXY_TLS = "true";
    const options = {
      bucket: "concurrency-test",
      maxRequests: 10,
      windowMs: 60_000,
      maxConcurrent: 1,
    };
    const request = new Request("http://kivo.internal/api/guard", {
      headers: {
        authorization,
        "x-forwarded-proto": "https",
        "x-forwarded-host": "kivo.test",
      },
    });
    const first = await withApiRequestGuard(request, options, async () => new Response(
      new ReadableStream<Uint8Array>({ start() {} })
    ));
    const second = await withApiRequestGuard(request, options, async () => new Response("unexpected"));

    expect(second.status).toBe(503);
    await first.body?.cancel();

    const third = await withApiRequestGuard(request, options, async () => new Response("ok"));
    expect(third.status).toBe(200);
    await third.text();
  });
});
