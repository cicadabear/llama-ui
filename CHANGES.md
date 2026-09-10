# llama-ui — what this is and what changed

**llama-ui** is a lightweight, **open-webui replacement** for measuring the
token speed of *any* model backend. It is built directly on **llama.cpp's own
web UI** (`llama.cpp/tools/ui`, a SvelteKit app), which already shows a
tokens/second readout. The stock UI, however, can only talk to its own
llama.cpp server; the changes below let it talk to **any custom
OpenAI-compatible endpoint** (another llama.cpp server, vllm, LM Studio, …) and
report per-reply speed + token usage.

This directory is a **self-contained copy** of `llama.cpp/tools/ui` (minus the
C++ embedding glue: `CMakeLists.txt`, `sources.cmake`, `ui.cpp.in`, `ui.h.in`),
so it builds and runs on its own via the included `Dockerfile`.

> **Licensing.** The base UI is **llama.cpp**, MIT-licensed — see [`LICENSE`](LICENSE).
> The changes below are covered by that same MIT license.

## The changes (relative to stock `llama.cpp/tools/ui`)

| File | Change |
| --- | --- |
| `src/lib/utils/api-base.ts` | **New.** Single source of truth for a runtime-configurable API base (read from `localStorage["llamaui.apiBase"]`, same-origin fallback). `resolveApiUrl()` **de-duplicates a trailing `/v1`** in the base. `persistApiBase()` writes the base **without a reload**; `setApiBase()` persists + reloads. |
| `src/lib/constants/api-endpoints.constants.ts` | Every endpoint path is exposed as a **lazy getter** that calls `resolveApiUrl()` at access time (instead of a value baked at module init), so an endpoint change takes effect **without a page reload**. |
| `src/lib/hooks/speed-meter.ts` | **New.** Client-side, backend-agnostic speed meter (Svelte store): `clearSpeed()` at stream start, `recordSpeed()` on completion. Derives TTFT + tok/s + token count from the browser clock + `usage.completion_tokens`. |
| `src/lib/services/chat.service.ts` | Adds `stream_options.include_usage`; records first/last **token** times + count (content **and** reasoning, so reasoning models measure correctly); reads *thinking* from `delta.reasoning` (vllm 0.27.x) as a fallback for `reasoning_content`; clears any previous readout at stream start and records the **final sample only on completion**. Also **skips the llama.cpp-only `/v1/streams/lookup` probe when an external (OpenAI-compatible) endpoint is set** (it 404s against vllm), keeping the console clean. |
| `src/lib/stores/tools.svelte.ts` | **Skips the llama.cpp-only `/tools` (server-tools) fetch when an external (OpenAI-compatible) endpoint is set** (vllm has no `/tools`; the app's built-in client tools are unaffected), so it doesn't 404 in the console. |
| `src/lib/components/app/SpeedMeter.svelte` | **New.** Compact `⚡ speed …` readout, rendered **on the assistant message** (appears once the reply completes — no live ticking, no corner readout). |
| `src/lib/components/app/chat/.../ChatMessageAssistant.svelte` | Renders the per-message `SpeedMeter` on the last assistant message. |
| `src/lib/components/app/settings/SettingsChat/SettingsChatApiEndpoint.svelte` | **New.** The **API endpoint** field in Settings → General. **Apply** persists the base (no reload) and lists the endpoint's models below the field, **first auto-selected**. It also hosts a masked **API key** field (password + show/hide eye) for endpoints that require one — see *API key* below. |
| `src/lib/constants/settings.constants.ts` | Marks the **API key** entry `standaloneField: false` so it no longer appears as a standalone field in the General list (the endpoint panel renders it instead), and gives the entry a backend-agnostic, privacy-aware help string. |
| `src/lib/components/app/settings/SettingsChat/SettingsChat.svelte` | Excludes `apiKey` from the bulk **Save** write: the endpoint panel is the key's sole owner (it writes straight to the store), so a stale snapshot taken by the Save button can never clobber it. |
| `src/lib/stores/models/index.svelte.ts` | Auto-selects the **first** model once the list loads from the configured API. |
| `src/routes/+layout.svelte` | Routes the `/props` capability probe through the configured base. |
| `Dockerfile`, `server.mjs`, `.dockerignore` | **New.** Two-stage build (`npm ci` + `vite build`) + a dependency-free static server that answers the startup probe paths (`/props`, `/tools`, `/v1/models`, `/v1/streams/lookup`) with a **valid-but-empty 200** (other API paths get a clean JSON 404), so a not-yet-configured same-origin origin stays quiet in the console. |
| `README.md` | Replaced with the project README (build/run + how to read the speed + measured results). |

### Why a client-side speed meter

The built-in per-message statistics render only when a message carries
server-embedded `timings` (`predicted_n`, `predicted_ms`, …) — fields added by a
llama.cpp server, **not** part of the OpenAI spec. A plain OpenAI-compatible
server (vllm) does not send them, so the built-in meter stays blank. The new
client-side `SpeedMeter` derives TTFT/tok/s from the browser clock and the
standard `usage.completion_tokens`, which vllm does send — so it works against
any OpenAI endpoint.

### Keeping the console clean against OpenAI/vllm backends

The stock UI probes several **llama.cpp-only** endpoints on startup and on every send — `/props`, `/tools`, and the resumable-stream `/v1/streams/lookup`. A plain OpenAI-compatible backend (vllm) has none of these, so each probe returns a 404 and the console fills with "Failed to load resource: 404" plus app error logs. The app degrades gracefully to basic "model mode" (chat + speed still work), but the noise looks alarming. Two small changes keep the console clean without changing behavior:

- `server.mjs` answers the **same-origin** probe paths with a **valid-but-empty 200** (e.g. `/props` → `{}`, `/v1/models` → `{"data": []}`), so a not-yet-configured origin is quiet.
- With an **external** endpoint configured, the app **skips** the llama.cpp-only `/tools` and `/v1/streams/lookup` probes (a vllm/OpenAI endpoint has neither). The OpenAI-standard calls — `/v1/models` and `/v1/chat/completions` — still go to the configured endpoint as before.

### API key (optional, for endpoints that require one)

The stock UI already sends the configured API key as `Authorization: Bearer <key>`
(`getAuthHeaders()`), redacts it from logs/headers, and keeps it out of settings
exports — but the field lived in the **General** list, far from the endpoint it
authenticates. These changes re-home it next to the endpoint:

- The endpoint panel gains a masked **API key (optional)** input — a **password**
  field with a **show/hide** (eye) toggle — placed directly under the endpoint.
  It is **masked by default** and auto-saved to `localStorage` on every keystroke,
  so it persists across reloads without touching the (unrelated) Save button.
- The key is sent as `Authorization: Bearer <key>` on the OpenAI-standard calls
  (`/v1/models`, `/v1/chat/completions`) — the same headers the stock UI already
  built, so no new auth scheme was introduced.
- It stays **private by design**: stored only in this browser's `localStorage`,
  **never included in settings exports**, and **redacted from logs/headers**
  (the stock `REDACTED` set already covered `authorization`/`api-key`).

### Known cosmetic caveat

`scripts/dev.sh` and `scripts/git-hooks/` still assume the **llama.cpp checkout
layout** (they `cd` to the repo root). They are local-development helpers only
and are **not used by the Docker build**; the Docker image is fully
self-contained.

## Build & run

```bash
docker build -f Dockerfile -t llama-ui .
docker run -p 8080:8080 llama-ui
# open http://<host>:8080 → Settings → General → API endpoint → <your backend> → Apply
```
