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
// type-only import (no runtime edge) so this module can be imported by both
// the chat service and the stores without a dependency cycle
import type { ChatMessageTimings } from '$lib/types/chat';

export interface SpeedSample {
	/** epoch ms when the sample was finalized */
	atMs: number;
	/** time to first content token, ms (from request start) — i.e. the prefill phase */
	ttftMs?: number;
	/** first -> last content token duration, ms */
	genMs?: number;
	/** output tokens (usage.completion_tokens when available, else delta count) */
	tokens?: number;
	/** prefill tokens processed before the first output token (usage.prompt_tokens) */
	promptTokens?: number;
	/** prefill throughput, tokens/sec (promptTokens / ttftMs) */
	prefillTokPerSec?: number;
	/** generation throughput, tokens/sec */
	genTokPerSec?: number;
	/** the model id, when known */
	model?: string | null;
}

/** latest sample (null until the first completion finishes) */
export const speed$: Writable<SpeedSample | null> = writable<SpeedSample | null>(null);

/** a short ring of recent samples */
export const speedHistory$: Writable<SpeedSample[]> = writable<SpeedSample[]>([]);

/**
 * Time to first content token (ms), known the moment the first token arrives —
 * far earlier than the final sample, which is only recorded at completion.
 * Cleared when a new request starts.
 */
export const ttft$: Writable<number | null> = writable<number | null>(null);

export function recordSpeed(sample: SpeedSample): void {
	speed$.set(sample);
	if (sample.ttftMs !== undefined) ttft$.set(sample.ttftMs);
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

/** Latest sample without a subscription (null until the first completion). */
export function getSpeed(): SpeedSample | null {
	let latest: SpeedSample | null = null;

	const unsubscribe = speed$.subscribe((value) => (latest = value));

	unsubscribe();

	return latest;
}

/**
 * Map the latest client-side sample onto the message `timings` shape the UI
 * already renders: prefill as `prompt_n`/`prompt_ms` (prompt tokens ÷ time to
 * first token) and generation as `predicted_n`/`predicted_ms`. Only meaningful
 * when the backend itself did not emit timings (e.g. a plain vllm endpoint).
 */
export function speedToTimings(sample: SpeedSample | null = getSpeed()): ChatMessageTimings | undefined {
	if (!sample || (sample.ttftMs === undefined && sample.genTokPerSec === undefined)) return undefined;

	const promptMs = sample.ttftMs ?? 0;
	const promptN = sample.promptTokens ?? 0;
	const predictedN = sample.tokens ?? 0;
	// tokens ÷ (tokens/sec) is the duration in SECONDS; the timings fields
	// are milliseconds, so convert (genMs itself is already ms)
	const predictedMs = sample.genMs ?? (sample.tokens && sample.genTokPerSec ? (sample.tokens / sample.genTokPerSec) * 1000 : 0);

	return {
		cache_n: 0,
		predicted_ms: Math.round(predictedMs),
		predicted_n: Math.round(predictedN),
		// prefill only when the endpoint reported the prompt token count
		...(sample.promptTokens != null
			? { prompt_ms: Math.round(promptMs), prompt_n: Math.round(promptN) }
			: {})
	};
}


