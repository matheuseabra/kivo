# Hosted access for a single-owner VM

Hosted mode adds one Basic-authenticated owner boundary for the whole Kivo instance. It does not add accounts, project ownership, or multi-tenant isolation. Keep the VM behind a TLS reverse proxy and do not expose the Next.js listener directly to the internet.

## Enable hosted mode

Set these environment variables on the VM:

```sh
KIVO_HOSTED=true
KIVO_AUTH_USERNAME=owner-name
KIVO_AUTH_PASSWORD=a-long-random-password
```

When `KIVO_HOSTED=true`, missing or invalid username/password configuration fails closed with HTTP 503. Requests without valid HTTP Basic credentials receive HTTP 401. Hosted requests over plain HTTP receive HTTP 426. Basic credentials are sent on every request, so use HTTPS.

For production hosted mode, set `KIVO_TRUST_PROXY_TLS=true` behind a TLS reverse proxy. The proxy must overwrite `X-Forwarded-Proto` and `X-Forwarded-Host`, and the Next.js listener must accept traffic only from that proxy. Kivo then requires `X-Forwarded-Proto: https` and a valid forwarded host for every hosted request, and uses that host to check request origins. Kivo does not treat the URL scheme reconstructed by Next.js as proof of a TLS connection. Do not enable this setting on a directly exposed listener or behind a proxy that preserves client-supplied forwarding headers.

For an isolated, non-production loopback smoke test only, `KIVO_ALLOW_INSECURE_HOSTED_LOCAL=true` permits HTTP when `NODE_ENV` is not `production` and the host is `localhost`, `127.0.0.1`, or `::1`. This does not permit plain HTTP on other hosts.

The access gate covers pages and API paths, including all HTTP methods. It leaves Next.js build assets and packaged public sample assets available to the browser. Hosted state-changing requests must include a same-origin `Origin`; a cross-site `Sec-Fetch-Site` value is rejected. Keep the same-origin application on a single trusted origin.

## Provider keys

Hosted mode is strictly BYOK. Provider API routes accept the existing provider key headers and ignore operator API-key environment variables. The browser sends a provider key with the request that uses it. Kivo does not save that key on the server. `/api/env-status` returns `false` for every provider in hosted mode, even when operator keys exist in the process environment.

Browser-entered provider keys stay in JavaScript memory for the current page session. Reloading the page or closing the tab removes them. Older browser settings are migrated into memory and scrubbed from local storage. Workflow exports do not include provider keys. The settings screens say that keys are not verified; `/api/env-status` reports local server environment presence only and does not validate a browser key.

The resolver accepts both existing model-route aliases where they differ:

| Provider | Accepted request header | Local environment fallback |
| --- | --- | --- |
| Gemini | `X-Gemini-API-Key` | `GEMINI_API_KEY` |
| OpenAI | `X-OpenAI-API-Key` | `OPENAI_API_KEY` |
| Anthropic | `X-Anthropic-API-Key` | `ANTHROPIC_API_KEY` |
| Replicate | `X-Replicate-API-Key`, `X-Replicate-Key`; legacy `X-API-Key` on its provider-model endpoint | `REPLICATE_API_KEY` |
| fal.ai | `X-Fal-API-Key`, `X-Fal-Key`; legacy `X-API-Key` on its provider-model endpoint | `FAL_API_KEY` |
| Kie.ai | `X-Kie-Key` | `KIE_API_KEY` |
| WaveSpeed | `X-WaveSpeed-Key` | `WAVESPEED_API_KEY` |

Local mode keeps header-first, environment-second behavior, including the existing fal.ai keyless generation path. Existing response shapes and messages remain in place; hosted requests that require a provider key return HTTP 401 when the user key is missing.

The provider-model endpoints do not use the app's `Authorization` header as a provider key. Replicate's `api_key` query parameter is no longer accepted, because query strings can appear in browser history and server logs.

## Request limits

Hosted requests have a process-wide proxy limit of 300 requests per minute. Provider-facing handlers also apply the following per-process rate and concurrency limits:

| Handler | Requests per minute | Concurrent requests | Streamed body limit |
| --- | ---: | ---: | ---: |
| Generate | 20 | 2 | 32 MiB |
| Generate poll | 120 | 8 | 64 KiB |
| LLM | 30 | 3 | 16 MiB |
| Chat | 20 | 2 | 8 MiB |
| Quickstart and proposal | 10 each | 2 each | 1 MiB each |
| Model list, schema, and provider model endpoints | 60 each | 4 each | No request body |

The request body guard checks a declared `Content-Length` when present and also reads the body stream up to the limit. `Content-Length` alone is not treated as a body-size bound. Increase a limit only when the single-owner deployment needs it and the VM has capacity for the corresponding memory use.

These counters live in one Node.js process. They reset on restart and do not coordinate across workers, containers, or hosts. Run one application process for these application limits to apply consistently, and configure matching rate and request-size limits at the reverse proxy. Next.js also recommends using a reverse proxy for self-hosted deployments: [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting).

## Media URLs

`/api/images/[id]` serves temporary process-local image data and remains behind authentication. A source search found no current caller of `uploadImageForUrl`, so no active provider flow depends on an unauthenticated image URL. If a future provider needs to fetch an image from Kivo, add a scoped, expiring signed URL before allowing that request through the access gate.
