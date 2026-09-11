<script lang="ts" runes>
	import { ttft$ } from '$lib/hooks/speed-meter';
	import { ChatMessageStatistics } from '$lib/components/app';
	import { ChatMessageStatisticsMode } from '$lib/enums';
	import type { UseProcessingStateReturn } from '$lib/hooks/use-processing-state.svelte';
	import { agenticStore } from '$lib/stores';

	interface Props {
		message: DatabaseMessage;
		isLoading: boolean;
		processingState: UseProcessingStateReturn;
		showMessageStats: boolean;
	}

	let { isLoading, message, processingState, showMessageStats }: Props = $props();

	// A running agentic flow stamps per-turn timings on its root message at each
	// turn boundary and the cumulative agentic totals only on exit; while it runs,
	// show the session's live totals on the root message instead.
	const liveLlm = $derived(agenticStore.getLiveLlmTotals(message.convId));
	const isLiveFlowRoot = $derived(
		liveLlm !== null && agenticStore.getFlowRootMessageId(message.convId) === message.id
	);

	// TTFT for finished replies is the persisted prompt_ms (the client-measured
	// time-to-first-token for OpenAI endpoints such as vllm). While a reply is
	// streaming, the live ttft channel is set the moment the FIRST token
	// arrives — no waiting for the reply to finish. The live store is only
	// consulted for the message currently streaming, so older messages always
	// show their own persisted value.
	const persistedTtft = $derived(
		message.timings?.prompt_ms != null ? message.timings.prompt_ms : null
	);

	let liveTtft = $state<number | null>(null);

	$effect(() => {
		const unsubscribe = ttft$.subscribe((value) => (liveTtft = value));
		return unsubscribe;
	});
</script>

{#if showMessageStats && isLiveFlowRoot && liveLlm}
	<ChatMessageStatistics
		isLive
		mode={ChatMessageStatisticsMode.GENERATION}
		predictedMs={liveLlm.predicted_ms}
		predictedTokens={liveLlm.predicted_n}
		promptMs={liveLlm.prompt_ms}
		promptTokens={liveLlm.prompt_n}
		ttftMs={persistedTtft}
	/>
{:else if showMessageStats && message.timings && message.timings.predicted_n && message.timings.predicted_ms}
	{@const agentic = message.timings.agentic}
	<ChatMessageStatistics
		agenticTimings={agentic}
		mode={ChatMessageStatisticsMode.GENERATION}
		predictedMs={agentic ? agentic.llm.predicted_ms : message.timings.predicted_ms}
		predictedTokens={agentic ? agentic.llm.predicted_n : message.timings.predicted_n}
		promptMs={agentic ? agentic.llm.prompt_ms : message.timings.prompt_ms}
		promptTokens={agentic ? agentic.llm.prompt_n : message.timings.prompt_n}
		ttftMs={persistedTtft}
	/>
{:else if isLoading && showMessageStats}
	{@const liveStats = processingState.getLiveProcessingStats()}
	{@const genStats = processingState.getLiveGenerationStats()}

	{#if genStats}
		<ChatMessageStatistics
			isLive
			mode={ChatMessageStatisticsMode.GENERATION}
			predictedMs={genStats.timeMs}
			predictedTokens={genStats.tokensGenerated}
			promptMs={liveStats?.timeMs}
			promptTokens={liveStats?.tokensProcessed}
			ttftMs={liveTtft ?? persistedTtft}
		/>
	{:else if liveTtft != null}
		<!-- OpenAI endpoints without server processing state (e.g. vllm): show the
			client-measured TTFT the moment the first token arrives -->
		<ChatMessageStatistics mode={ChatMessageStatisticsMode.READING} ttftMs={liveTtft} />
	{/if}
{/if}
