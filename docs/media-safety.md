# Outbound media downloads

Server code that downloads media from a URL must use `safeFetchMedia` from `src/lib/server/safeMediaFetch.ts`. Do not use `fetch(url)` for provider output or `/api/save-generation` downloads.

The helper accepts HTTP and HTTPS URLs without URL username or password fields. Before each request, it resolves every DNS answer and rejects the destination if any address is not globally routable. The connection uses the first validated address through a pinned Node HTTP or HTTPS agent. It does not copy caller headers, cookies, or provider request authorization headers. It sends only media `Accept` and `Accept-Encoding: identity` headers.

Redirects are followed manually, up to three hops by default. Every redirected URL is parsed, resolved and checked again. One 60-second deadline covers DNS, redirects, headers and the streamed body. The default body limit is 100 MiB. Call sites that already support larger generated media can set a higher explicit limit, up to their product policy; current save and selected provider flows use 500 MiB. The helper checks declared length when it is a valid number and always enforces the cap while streaming.

Callers identify the expected media kind. Images, videos, audio and 3D models each have a MIME allowlist. SVG and HTML are not accepted as downloaded image output. The generic `media` kind is for providers whose output can be an image, video or audio file; callers can supply a fallback kind when a provider omits its content type.

Tests inject the resolver and HTTP response stream. They cover public IPv4 and IPv6 addresses, private and mapped addresses, mixed DNS answers, private redirects, redirect limits, invalid content types, chunked size limits and timeouts. These tests do not make external network requests.

The helper secures server-side downloads. A provider result that is returned as a URL for browser-side use does not pass through this server download boundary.

Gemini Veo download URIs are accepted only from `https://generativelanguage.googleapis.com`. The API key is added only after this exact host and HTTPS check. The URL is never logged, and the safe downloader does not copy its query parameters to a redirect destination.
