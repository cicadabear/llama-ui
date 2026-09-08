/**
 * Client-side, backend-agnostic token-speed meter.
 *
 * The built-in UI stats (tokensPerSecond / promptProgress) are computed from
 * timing fields that only a llama.cpp server emits in its stream chunks. A plain
 * OpenAI-compatible endpoint (e.g. vllm serving qwen38) does not send them, so
 * the built-in readout would be blank. This module measures speed entirely on
 * the client (wall clock + token count), so it works against ANY endpoint.
 *
 * It is fed by the chat stream handler (chat.service.ts) via recordSpeed().
 * A plain .ts module (using a Svelte store) so it can be imported from both the
 * .ts service and .svelte components without Svelte-5 rune-import restrictions.
 */
import { writable, type Writable } from 'svelte/store';

export interface SpeedSample {
	/** epoch ms when the sample was finalized */
	atMs: number;
	/** time to first content token, ms (from request start) */
	ttftMs?: number;
	/** first -> last content token duration, ms */
	genMs?: number;
	/** output tokens (usage.completion_tokens when available, else delta count) */
	tokens?: number;
	/** generation throughput, tokens/sec */
	genTokPerSec?: number;
	/** the model id, when known */
	model?: string | null;
}

/** latest sample (null until the first completion finishes) */
export const speed$: Writable<SpeedSample | null> = writable<SpeedSample | null>(null);

/** a short ring of recent samples */
export const speedHistory$: Writable<SpeedSample[]> = writable<SpeedSample[]>([]);

export function recordSpeed(sample: SpeedSample): void {
	speed$.set(sample);
	speedHistory$.update((h) => [...h, sample].slice(-50));
	// surface it in the console too — handy when testing from a headless run
	// eslint-disable-next-line no-console
	console.info(
		`[speed-meter] ${sample.model ?? 'model'}: TTFT ${
			sample.ttftMs !== undefined ? Math.round(sample.ttftMs) + 'ms' : '?'
		}, ${sample.tokens ?? '?'} tok in ${((sample.genMs ?? 0) / 1000).toFixed(2)}s = ${
			sample.genTokPerSec !== undefined ? sample.genTokPerSec.toFixed(1) : '?'
		} tok/s`
	);
}

export function clearSpeed(): void {
	speed$.set(null);
	speedHistory$.set([]);
}


