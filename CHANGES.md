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
| `src/lib/services/chat.service.ts` | Adds `stream_options.include_usage`; records first/last **token** times + count (content **and** reasoning, so reasoning models measure correctly); reads *thinking* from `delta.reasoning` (vllm 0.27.x) as a fallback for `reasoning_content`; clears any previous readout at stream start and records the **final sample only on completion**. |
| `src/lib/components/app/SpeedMeter.svelte` | **New.** Compact `⚡ speed …` readout, rendered **on the assistant message** (appears once the reply completes — no live ticking, no corner readout). |
| `src/lib/components/app/chat/.../ChatMessageAssistant.svelte` | Renders the per-message `SpeedMeter` on the last assistant message. |
| `src/lib/components/app/settings/SettingsChat/SettingsChatApiEndpoint.svelte` | **New.** The **API endpoint** field in Settings → General. **Apply** persists the base (no reload) and lists the endpoint's models below the field, **first auto-selected**. |
| `src/lib/stores/models/index.svelte.ts` | Auto-selects the **first** model once the list loads from the configured API. |
| `src/routes/+layout.svelte` | Routes the `/props` capability probe through the configured base. |
| `Dockerfile`, `server.mjs`, `.dockerignore` | **New.** Two-stage build (`npm ci` + `vite build`) + a dependency-free static server that answers API-looking paths with a clean JSON 404 (not `index.html`). |
| `README.md` | Replaced with the project README (build/run + how to read the speed + measured results). |

### Why a client-side speed meter

The built-in per-message statistics render only when a message carries
server-embedded `timings` (`predicted_n`, `predicted_ms`, …) — fields added by a
llama.cpp server, **not** part of the OpenAI spec. A plain OpenAI-compatible
server (vllm) does not send them, so the built-in meter stays blank. The new
client-side `SpeedMeter` derives TTFT/tok/s from the browser clock and the
standard `usage.completion_tokens`, which vllm does send — so it works against
any OpenAI endpoint.

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
