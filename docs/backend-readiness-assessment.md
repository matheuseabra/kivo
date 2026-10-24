# Backend and BYOK readiness assessment

Assessed: 2026-10-24. Scope: current working tree, existing local UI, and focused tests. This is an assessment, not a deployment approval or a full security audit.

## Decision

UI-based bring-your-own-key (BYOK) is appropriate for this product and already exists. The application has substantial working provider integrations, but its backend is designed for a trusted local operator. It is not ready for public VM hosting as written.

No new credential screen is needed. Preserve the existing provider UI and address its storage and API coverage before deployment.

## Existing credential flow

- Open **Project settings → Providers**. When a server key exists, choose **Override**, enter a personal key, and choose **Save**. Without a server key, the input appears directly.
- The same providers appear during onboarding: Gemini, OpenAI, Anthropic, Replicate, fal.ai, Kie.ai, and WaveSpeed. OpenAI and Anthropic serve text-generation nodes.
- `src/components/ProjectSetupModal.tsx` saves credentials through `updateProviderApiKey` in `src/store/workflowStore.ts`.
- `src/store/utils/localStorage.ts` persists provider settings, including raw keys, under `node-banana-provider-settings`. These settings belong to the browser origin, despite appearing under Project Settings. They are not scoped to an individual project or account.
- `src/store/utils/buildApiHeaders.ts` attaches the selected provider key to generation requests. `src/app/api/generate/route.ts` prefers request headers over server environment variables. Polling follows the same pattern for Kie.
- `src/app/api/env-status/route.ts` returns configuration booleans, not secret values. A configured flag does not validate a key with the provider.
- `WorkflowFile` does not include provider settings. Export is not a credential backup; imported node payloads still require normal untrusted-input handling.

**Verified UI:** inspected the Providers tab and Kie Override input in Helium at `localhost:3001`. Inputs are masked by default. No keys were entered or saved, and no paid generation was performed. A screenshot also showed the welcome dialog overlapping settings on the empty canvas; this is a discoverability/modal issue to reproduce and fix before release. Further visual inspection stopped when the browser window became unavailable.

## Frontend/backend parity

| Frontend feature | Backend / implementation | Assessment |
| --- | --- | --- |
| Image generation | `/api/generate`, provider handlers for Gemini, Replicate, fal, Kie, WaveSpeed | Real integration; request-key override supported. Provider/model availability was not live-tested. |
| Video, audio, 3D generation | Same generation route, media-specific executors and response fields | Real integration paths; support depends on selected model/provider. This does not establish that every model works. |
| Text generation | `/api/llm`, Google/OpenAI/Anthropic handlers | Request keys plus environment fallback are implemented. |
| Prompt a workflow | `/api/quickstart`; `PromptWorkflowView` and chat build action in `WorkflowCanvas` | **Credential mismatch:** backend reads only `GEMINI_API_KEY`; clients do not forward the UI key. |
| Workflow proposal | `/api/quickstart/propose` | Also environment-only. No current client caller found in the source search. |
| Chat/edit workflow | `/api/chat`, `ChatPanel` | Real streaming/tool integration; **environment-only Gemini key**, unlike generation. |
| Run pipelines, batches, fallback | Zustand store and `src/store/execution/` | Browser orchestrates execution. No durable server job scheduler or restart recovery found. Closing the tab stops client coordination, though an already-submitted provider job may continue. |
| Save/load projects and history media | `/api/workflow`, `/api/workflow-images`, `/api/save-generation`, `/api/load-generation`, `/api/list-workflows` | Real filesystem persistence on the server machine. No per-user ownership boundary. Remote hosting changes the meaning of a project directory. |
| Browse/reveal directories and files | `/api/browse-directory`, `/api/open-directory`, `/api/open-file` | Native server OS integration. It cannot open a remote visitor's file manager; unsuitable for a headless VM. |
| Annotation, transforms, video editing | Client canvas, image utilities, media hooks | Primarily browser features. Do not require a server encoder, but browser/device compatibility needs acceptance tests. |
| Community templates | `/api/community-workflows` and `[id]` | Proxy to an external nodebananapro.com service. This is an external dependency, not a locally owned community backend. Availability was not verified. |
| Cost display | Local workflow cost data and provider pricing metadata | Estimates/tracking exist. No server billing ledger, user budget enforcement, or authoritative provider reconciliation found. |

## Required changes before external exposure

### P0: access and storage boundaries

1. Protect UI and every API route with authentication. For a personal VM, an authenticated gateway is a reasonable first boundary; a shared product needs application sessions and resource ownership checks. No application authentication or rate limiter was found in the inspected routes.
2. Decide whether hosted mode is strictly BYOK. Currently a missing user key falls back to the operator's environment key. An unauthenticated request can therefore spend operator funds. Hosted BYOK should reject missing user credentials unless a funded shared-key policy is explicitly enabled and budgeted.
3. Replace arbitrary client-supplied filesystem paths with server-controlled project IDs and a dedicated data root. Apply containment checks, including symlinks, to every read/write/list endpoint. `validateWorkflowPath` only denies selected system directories; generation save/load routes do not apply that helper. A VM would otherwise expose its own filesystem to these operations.
4. Disable desktop directory/dialog endpoints in hosted mode. Replace their UI with project selection, browser uploads/downloads, and server-managed storage. Current guards target Vercel, not all remote/headless deployments.
5. Harden outbound media fetching. `/api/save-generation` fetches a supplied URL without using `validateMediaUrl`. The existing validator checks literal host/IP strings but does not resolve DNS or revalidate redirects. Protect against private-network/metadata access and cap downloaded bytes.
6. Validate JSON shapes, media types, IDs and filenames consistently. Bound request size, image/video dimensions, execution concurrency, disk use and duration. The 100 MB Server Actions setting does not impose a Route Handler body limit.

### P1: complete the BYOK contract and reliability

1. Pass the UI Gemini key through all prompt-to-workflow and chat requests, including the canvas chat build action. Resolve it server-side with the same precedence as generation. Add regression tests proving a user key works with environment keys absent.
2. Replace permanent plaintext local-storage credentials. For a personal tool, default to memory-only credentials with a clear lifetime and explicit removal. For multi-user hosting, store saved keys encrypted server-side, tied to an authenticated user, and return only status/metadata. Memory-only credentials still require XSS defenses while the page is open.
3. Separate **key saved/configured** from **provider verified**. Add clear provider errors and an explicit connection check that does not silently trigger paid generation. Provide removal/rotation controls and disclose credential storage and scope.
4. Persist job IDs and run state, add idempotency and bounded retries, and define cancellation behavior. Durable background execution is needed if the product promises that runs survive tab closure or server restarts. Existing Kie client polling is useful but is not a durable run ledger.
5. Audit logs and provider errors for prompts, media, paths, URLs and credentials. `/api/logs` accepts client sessions and writes them to disk; validate session IDs and bound log volume. `save-generation` logs prompt content. Add redaction and retention controls.
6. Bound and expire temporary media. `src/lib/images/store.ts` is a process-local Map with caller-managed deletion and no TTL; restart loses its contents and multiple processes do not share it.

### P2: VM packaging and release gates

1. Make the normal typecheck pass. Restore a usable lint command: `package.json` currently uses `next lint` with Next 16.
2. Verify a production build in an isolated checkout/build directory, then smoke-test the production server. `npm run dev` runs `server.js`, which extends HTTP timeouts; `npm start` runs `next start`, so those custom settings are not used in production.
3. Add a reproducible Linux/container build, a non-root service, persistent data volume, backups plus a restore test, health/readiness checks, graceful shutdown and disk monitoring. No Dockerfile/compose definition was found.
4. Put a reverse proxy with TLS, authentication, payload/rate limits and streaming support in front of the service. Set proxy and application timeouts intentionally for generation and chat.
5. Test from a remote browser against a headless Linux staging instance: user keys without `.env` keys, each supported media category, save/reload, disconnect/reconnect, restart recovery, missing/invalid credentials and unauthorized access. Use explicitly approved paid smoke tests for live providers.

## Validation performed

- Existing focused tests passed (exit 0): `buildApiHeaders`, `localStorage`, `ProjectSetupModal`, `/api/generate`, `/api/llm` using `npm run test:run -- <five test paths>`. These tests mock provider calls. React `act(...)` warnings were emitted by the settings tests.
- `npx tsc --noEmit` failed (exit 2), including invalid mock callback types in generation tests, outdated `WorkflowSaveConfig`/cost fixtures in localStorage tests, and other test typing errors. This is the current baseline; no source was modified for this assessment.
- The existing local development server was reused. No production build was run against its active `.next` directory. Full suite, dependency/security audit, live provider operation and Linux/VM runtime remain unverified.
- Existing unrelated README/package changes and deleted skill files were left untouched. This document is the only intentional file addition.

## Recommended next milestone

Target an authenticated, single-owner VM first unless multiple independent users are an immediate requirement. Keep the Next.js backend, add an explicit hosted mode, constrain project storage, finish BYOK coverage, and close the P0 issues before packaging/deploying. Add a database and durable worker when account ownership or background-run guarantees require them. A rewrite or a second API service is not established as necessary by this assessment.

## Primary references

- [OWASP HTML5 Security: local storage](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#local-storage): sensitive information should not be kept in local storage, which is accessible to page JavaScript.
- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting): reverse proxy guidance and self-hosted runtime behavior.
