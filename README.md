# llama-ui — a lightweight custom-API web UI for token-speed testing

A small, **open-webui replacement** built by modifying **llama.cpp's own web UI**
(`tools/ui`, a SvelteKit app). llama.cpp's UI already shows a live tokens/second
readout — open-webui (≈1.8 GB) does not. The only thing the stock UI lacked was
the ability to point it at a **custom** model API, so you can measure the token
speed of *any* backend (another llama.cpp server, or an OpenAI-compatible
vllm / LM Studio endpoint) without a heavy third-party app.

Point it at your backend from **Settings → General → API endpoint** (e.g.
`http://192.168.32.27:8000`, with or without a trailing `/v1`). Click **Apply**
and the UI connects, lists the endpoint's models below the field with the first
one auto-selected, and each reply shows a **⚡ speed** readout
(TTFT · tok/s · token count) right on the message once the reply completes.

## What changed

| File | Change |
| --- | --- |
| `src/lib/utils/api-base.ts` | **New.** Single source of truth for a runtime-configurable API base (read from `localStorage["llamaui.apiBase"]`, same-origin fallback). `resolveApiUrl()` **de-duplicates a trailing `/v1`** so a base of `http://h:8000/v1` + `/v1/chat/completions` → `http://h:8000/v1/chat/completions` (not `/v1/v1/…`). `persistApiBase()` writes the base **without reloading**; `setApiBase()` persists + reloads. |
| `src/lib/constants/api-endpoints.constants.ts` | Every endpoint is exposed as a **lazy getter** (not a baked constant) that calls `resolveApiUrl()` at access time. This is what lets an endpoint change take effect **without a page reload** — the base is read on every use. |
| `src/lib/hooks/speed-meter.ts` | **New.** Client-side, backend-agnostic speed meter (Svelte store). `clearSpeed()` hides it at the start of each stream; `recordSpeed()` sets the **final** sample when the reply completes. Derives TTFT + tok/s + token count from the client clock + `usage.completion_tokens`. |
| `src/lib/services/chat.service.ts` | During streaming it (a) adds `stream_options.include_usage`, (b) records first/last **token** times + count (content **and** reasoning, so reasoning models measure correctly), (c) reads *thinking* from `delta.reasoning` (vllm 0.27.x) as a fallback for `reasoning_content`, (d) **clears any previous readout when a stream starts**, and (e) records the **final sample only on completion** — so the readout never flickers mid-stream. |
| `src/lib/components/app/SpeedMeter.svelte` | **New.** Compact readout: `⚡ speed  TTFT 428ms  66.5 tok/s  24 tok`. Rendered **on each assistant message**; it appears **only after the reply completes** (no live updates, no corner readout). |
| `src/lib/components/app/chat/.../ChatMessageAssistant.svelte` | Renders the per-message `SpeedMeter` on the last assistant message, so the speed + token usage sit with the reply. |
| `src/lib/components/app/settings/SettingsChat/SettingsChatApiEndpoint.svelte` | **New.** The **API endpoint** field in Settings → General. **Apply** persists the base (no reload) and fetches its models, which are **listed below the field with the first auto-selected** (radio to pick another); the model store updates live so the main chat follows. |
| `src/lib/stores/models/index.svelte.ts` | After the model list loads from the configured API, auto-selects the **first model** (`ensureFirstModelSelected()`). |
| `src/routes/+layout.svelte` | Routes the `/props` probe through the configured base. (The bottom-right `SpeedMeter` was removed — the readout now lives only on the message.) |
| `tools/ui/Dockerfile`, `server.mjs`, `.dockerignore` | **New.** Two-stage build (`npm ci` + `vite build`) + a tiny dependency-free static server that answers API-looking paths with a clean JSON 404 (not `index.html`). The llama.cpp-only paths (`/props`, `/tools`, …) 404 against vllm and the app degrades into **basic OpenAI mode** — no error dialog, no request flood. |

### Why a new speed meter (the built-in one can't be used against vllm)

The built-in per-message statistics (`ChatMessageAssistantStatistics`) renders
only when a message carries server-embedded `timings` (`predicted_n`,
`predicted_ms`, …). Those fields are **added by the llama.cpp server** — part of
its private protocol, not the OpenAI spec. A plain OpenAI-compatible server
(vllm) does **not** send them, so the built-in meter stays empty. The new
client-side `SpeedMeter` instead derives TTFT and tok/s from the browser clock
and the standard `usage.completion_tokens`, which vllm *does* send — so it works
against any OpenAI endpoint. It is deliberately **final-only**: it appears on
the message once the reply is done (no ticking readout while it streams).

## Build & run (Docker)

```bash
cd llama.cpp
sudo docker build -f tools/ui/Dockerfile -t llama-ui tools/ui/
sudo docker run -p 8080:8080 llama-ui
```

Open **`http://<host>:8080`** → **Settings → General → API endpoint** → enter the
backend (e.g. `http://192.168.32.27:8000` — a trailing `/v1` is fine and is
handled automatically) → **Apply**. The endpoint's models appear below the field
with the **first one auto-selected**; the base is remembered in the browser's
localStorage. Pick a model in the main selector (or in the list) and chat.

### The qwen38 / vllm endpoint (this box)

`http://192.168.32.27:8000` is a vllm server (vllm **0.27.1**) exposing the
OpenAI-compatible model `qwen3.8-27b-vllm`. It sends
`Access-Control-Allow-Origin: *`, so the browser can call it cross-origin.

## How to read the speed

- **TTFT** — time to first token (content *or* reasoning), from when the request was sent.
- **tok/s** — tokens ÷ (last-token time − first-token time); token count from
  `usage.completion_tokens` when available, else a delta count.
- The readout appears **on the message once the reply completes** (it is not
  shown while the reply is still streaming).
- Each completed reply also logs
  `[speed-meter] <model>: TTFT …, … tok in …s = … tok/s` to the console.

## Measured results (this box — Xeon E5-2696 v3, 20 threads, no GPU)

Against `http://192.168.32.27:8000` (`qwen3.8-27b-vllm`):

| source | TTFT | generation |
| --- | --- | --- |
| `speed_experiment.py` (raw OpenAI stream, `max_tokens=500`) | ≈ 220 ms | ≈ 55–62 tok/s |
| in-UI `⚡ speed` readout (per reply) | ≈ 430–440 ms | ≈ 57–76 tok/s |

**≈ 430 ms TTFT / ≈ 60 tok/s** as measured inside the UI for this 27B model on
CPU. The in-UI TTFT is a little higher than the raw figure because it includes
the browser round-trip and vllm's first-token latency; the generation rate
matches. vllm 0.27.x emits the model's *thinking* in `delta.reasoning` (not the
OpenAI-extension `reasoning_content`); the changes above handle both.

## Notes / caveats

- The primary send uses the **OpenAI-compatible** `POST /v1/chat/completions`
  (`stream: true`), implemented by both llama.cpp and vllm. llama.cpp's extra
  request fields are simply ignored by a plain OpenAI endpoint.
- **A trailing `/v1` in the endpoint is tolerated**: the endpoint paths already
  begin with `v1/…`, so `resolveApiUrl` drops the redundant prefix. Entering
  `…:8000` or `…:8000/v1` both work.
- llama.cpp's *resumable* `/v1/stream` reconnect protocol and the `/props`
  capability probe (plus `/tools`) are llama.cpp-specific; against a
  non-llama.cpp endpoint they 404 and the app degrades gracefully into basic
  OpenAI mode. They do not affect chat + speed.
- The endpoint must allow CORS from the page origin (vllm does, with `*`; a
  llama.cpp server reflects `Origin`).
- Because the endpoint constants are **lazy getters**, changing the endpoint in
  Settings → **Apply** takes effect immediately — no page reload required.
- **Verified in a driven browser with network capture** against this box, using
  the `/v1` form of the endpoint: the models list loads (`GET …/v1/models` →
  200), the first model auto-selects, the reply streams
  (`POST …/v1/chat/completions` → 200), **no error dialog**, **no corner
  readout**, and the per-message `⚡ speed` readout appears **only after the
  reply completes** (`TTFT 428ms · 66.5 tok/s · 24 tok`) — nothing ticks while
  the reply is still streaming.
