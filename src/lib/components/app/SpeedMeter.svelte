<script lang="ts" runes>
	/**
	 * Compact client-side speed readout (TTFT + tok/s + token count).
	 *
	 * Measured on the client, so it works against any endpoint (llama.cpp or a
	 * plain OpenAI-compatible server such as vllm). Fed by the speed-meter store
	 * which the chat stream handler updates on each completion.
	 *
	 * Uses an explicit `$effect` subscription (runes) rather than the legacy
	 * `$store` auto-subscription, which does not reliably re-render here.
	 */
	import { speed$ } from '$lib/hooks/speed-meter';
	import type { SpeedSample } from '$lib/hooks/speed-meter';

	let sample = $state<SpeedSample | null>(null);

	$effect(() => {
		const unsubscribe = speed$.subscribe((value) => {
			sample = value;
		});
		return unsubscribe;
	});
</script>

{#if sample}
	<div class="speed-meter" role="status" title="Client-side measured token speed (backend-agnostic)">
		<span class="badge" aria-hidden="true">⚡</span>
		<span class="label">speed</span>
		{#if sample.ttftMs !== undefined}
			<span class="kv">TTFT <b>{Math.round(sample.ttftMs)}ms</b></span>
		{/if}
		{#if sample.genTokPerSec !== undefined}
			<span class="kv rate">{sample.genTokPerSec.toFixed(1)} <em>tok/s</em></span>
		{/if}
		{#if sample.tokens !== undefined}
			<span class="kv">{sample.tokens} tok</span>
		{/if}
		{#if sample.model}
			<span class="kv model">{sample.model}</span>
		{/if}
	</div>
{/if}

<style>
	.speed-meter {
		display: inline-flex;
		gap: 0.5rem;
		align-items: baseline;
		font-size: 0.8rem;
		line-height: 1.2;
	}
	.badge {
		font-size: 0.9rem;
	}
	.label {
		font-weight: 600;
		opacity: 0.7;
	}
	.kv {
		opacity: 0.85;
	}
	.kv b {
		font-weight: 700;
	}
	.rate {
		font-weight: 700;
		color: var(--color-primary, #2563eb);
	}
	.rate em {
		font-style: normal;
		opacity: 0.7;
		font-weight: 600;
	}
	.model {
		opacity: 0.55;
		font-variant-numeric: tabular-nums;
	}
</style>
