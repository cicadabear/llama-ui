<script lang="ts">
	import { ActionIconCopyToClipboard, BadgesModality } from '$lib/components/app';
	import { speed$ } from '$lib/hooks/speed-meter';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Table from '$lib/components/ui/table';
	import { modelsStore, serverStore } from '$lib/stores';
	import type { ApiLlamaCppServerProps } from '$lib/types';
	import { formatFileSize, formatNumber, formatParameters } from '$lib/utils';

	interface Props {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		// when set, fetch props from the child process (router mode)
		modelId?: string | null;
	}

	let { modelId = null, onOpenChange, open = $bindable() }: Props = $props();

	let isRouter = $derived(serverStore.isRouterMode);

	// per-model props fetched from the child process
	let routerModelProps = $state<ApiLlamaCppServerProps | null>(null);
	let isLoadingRouterProps = $state(false);

	// in router mode use per-model props, otherwise use global props.
	//
	// A real llama.cpp `/props` response always carries `model_path`. When the
	// page is served by the standalone static server it answers `/props` with an
	// empty `{}`, and an OpenAI-compatible backend (e.g. vllm) has no `/props`
	// at all — both yield props without `model_path`. Treat those as "no props"
	// so the dialog shows the model-entry table (modalities, context, caps)
	// instead of a table full of empty llama.cpp rows.
	function hasLlamaCppProps(props: ApiLlamaCppServerProps | null): boolean {
		if (!props) return false;

		if (props.model_path) return true;

		// the router's per-model props can legitimately describe a model without
		// a local path; keep it when this is a real router-mode fetch
		return isRouter && (props.total_slots != null || props.build_info || props.chat_template);
	}

	// in router mode use per-model props, otherwise use global props
	let serverProps = $derived.by(() => {
		const raw = isRouter && modelId ? routerModelProps : serverStore.props;

		return hasLlamaCppProps(raw) ? raw : null;
	});

	let models = $derived(modelsStore.models);
	let isLoadingModels = $derived(modelsStore.loading);

	// in router mode, find the model option matching modelId
	// in single mode, use the first model as before
	let firstModel = $derived.by(() => {
		if (isRouter && modelId) {
			return models.find((m) => m.model === modelId) ?? null;
		}

		return models[0] ?? null;
	});

	// Human-friendly name: prefer the API's display name (e.g. vllm), else the
	// parsed display name, else the raw id.
	let modelName = $derived(
		firstModel?.displayName?.trim() || firstModel?.name || firstModel?.id || (isRouter && modelId ? modelId : null)
	);

	// Get modalities from modelStore using the model ID from the first model
	let modalities = $derived.by(() => {
		if (!firstModel?.id) return [];

		return modelsStore.props.getModelModalitiesArray(firstModel.id);
	});

	// Context window: /props n_ctx (llama.cpp) else the model entry's max_model_len
	// (OpenAI-compatible backends such as vllm).
	let contextSize = $derived.by(() => {
		if (!firstModel) return null;

		return modelsStore.props.getModelContextSize(firstModel.id);
	});

	// Performance of the most recent response, measured client-side so it works
	// against any backend (vllm/OpenAI as well as llama.cpp). Sourced from the
	// speed-meter store which the stream handler records for every completion.
	// Prefill = the prompt-processing phase before the first output token.
	let lastSpeed = $derived.by(() => {
		const s = $speed$;

		if (!s) return null;

		const ttft = s.ttftMs;
		const prefillSpeed =
			s.promptTokens && ttft ? s.promptTokens / (ttft / 1000) : s.prefillTokPerSec;

		return {
			prefillMs: ttft ? Math.round(ttft) : null,
			prefillSpeed: prefillSpeed ? Math.round(prefillSpeed) : null,
			promptTokens: s.promptTokens ?? null,
			outputTokens: s.tokens ?? null,
			genSpeed: s.genTokPerSec ? Math.round(s.genTokPerSec) : null
		};
	});

	// Feature capabilities the API entry advertises (e.g. vllm's
	// {vision, tools, reasoning}); llama.cpp entries leave this empty.
	let capabilities = $derived.by(() => {
		const caps = firstModel?.openaiCapabilities;

		if (!caps) return [];

		return Object.entries(caps)
			.filter(([, on]) => on)
			.map(([key]) => ({ key, label: capabilityLabel(key) }));
	});

	// Ensure models are fetched when dialog opens
	$effect(() => {
		if (open && models.length === 0) {
			modelsStore.fetch();
		}
	});

	// fetch per-model props from child process when dialog opens in router mode
	$effect(() => {
		if (open && isRouter && modelId) {
			isLoadingRouterProps = true;
			modelsStore.props
				.fetchModelProps(modelId)
				.then((props) => {
					routerModelProps = props;
				})
				.catch(() => {
					routerModelProps = null;
				})
				.finally(() => {
					isLoadingRouterProps = false;
				});
		}

		if (!open) {
			routerModelProps = null;
		}
	});

	/** Human-friendly label for a capability key advertised by the API entry. */
	function capabilityLabel(key: string): string {
		switch (key.toLowerCase()) {
			case 'vision':
				return 'Vision';
			case 'reasoning':
				return 'Reasoning';
			case 'tools':
			case 'tool_calling':
				return 'Tool calling';
			case 'functions':
				return 'Function calling';
			case 'audio':
				return 'Audio input';
			case 'video':
				return 'Video input';
			default:
				return key.charAt(0).toUpperCase() + key.slice(1);
		}
	}
</script>

<Dialog.Root bind:open {onOpenChange}>
	<Dialog.Content
		class="z-9999 max-md:h-[100dvh]! max-md:w-screen! max-md:max-w-none! md:w-[calc(100vw-4rem)]! md:max-w-[60rem]! md:max-h-[80dvh]!"
	>
		<!-- sticky header holds only the close button; the title scrolls with the body -->
		<Dialog.Header />

		<div class="min-w-0 space-y-6 md:py-4 -mt-4! md:mt-0 pb-4">
			<div class="min-w-0 space-y-2">
				<Dialog.Title>Model Information</Dialog.Title>

				<Dialog.Description>Current model details and capabilities</Dialog.Description>
			</div>

			{#if isLoadingModels || isLoadingRouterProps}
				<div class="flex items-center justify-center py-8">
					<div class="text-sm text-muted-foreground">Loading model information...</div>
				</div>
			{:else if firstModel}
				{@const modelMeta = firstModel.meta}

				{#if serverProps}
					<!-- llama.cpp: full detail table from /props -->
					<Table.Root class="hidden table-fixed md:table">
						<Table.Header>
							<Table.Row>
								<Table.Head class="w-[10rem]">Model</Table.Head>

								<Table.Head>
									<div class="flex min-w-0 items-center gap-2">
										<span class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">
											{modelName}
										</span>

										<ActionIconCopyToClipboard
											ariaLabel="Copy model name to clipboard"
											canCopy={!!modelName}
											text={modelName || ''}
										/>
									</div>
								</Table.Head>
							</Table.Row>
						</Table.Header>

						<Table.Body>
							<!-- Model Path -->
							<Table.Row>
								<Table.Cell class="h-10 align-middle font-medium">File Path</Table.Cell>

								<Table.Cell class="h-10 align-middle font-mono text-xs">
									<div class="flex min-w-0 items-center gap-2">
										<span class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">
											{serverProps.model_path}
										</span>

										<ActionIconCopyToClipboard
											ariaLabel="Copy model path to clipboard"
											text={serverProps.model_path}
										/>
									</div>
								</Table.Cell>
							</Table.Row>

							<!-- Context Size -->
							{#if contextSize !== null}
								<Table.Row>
									<Table.Cell class="h-10 align-middle font-medium">Context Size</Table.Cell>

									<Table.Cell>{formatNumber(contextSize)} tokens</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row>
									<Table.Cell class="h-10 align-middle font-medium text-red-500"
										>Context Size</Table.Cell
									>

									<Table.Cell class="text-red-500">Not available</Table.Cell>
								</Table.Row>
							{/if}

							<!-- Training Context -->
							{#if modelMeta?.n_ctx_train}
								<Table.Row>
									<Table.Cell class="h-10 align-middle font-medium">Training Context</Table.Cell>

									<Table.Cell>{formatNumber(modelMeta.n_ctx_train)} tokens</Table.Cell>
								</Table.Row>
							{/if}

							<!-- Model Size -->
							{#if modelMeta?.size}
								<Table.Row>
									<Table.Cell class="h-10 align-middle font-medium">Model Size</Table.Cell>

									<Table.Cell>{formatFileSize(modelMeta.size)}</Table.Cell>
								</Table.Row>
							{/if}

							<!-- Parameters -->
							{#if modelMeta?.n_params}
								<Table.Row>
									<Table.Cell class="h-10 align-middle font-medium">Parameters</Table.Cell>

									<Table.Cell>{formatParameters(modelMeta.n_params)}</Table.Cell>
								</Table.Row>
							{/if}

							<!-- Embedding Size -->
							{#if modelMeta?.n_embd}
								<Table.Row>
									<Table.Cell class="align-middle font-medium">Embedding Size</Table.Cell>

									<Table.Cell>{formatNumber(modelMeta.n_embd)}</Table.Cell>
								</Table.Row>
							{/if}

							<!-- Vocabulary Size -->
							{#if modelMeta?.n_vocab}
								<Table.Row>
									<Table.Cell class="align-middle font-medium">Vocabulary Size</Table.Cell>

									<Table.Cell>{formatNumber(modelMeta.n_vocab)} tokens</Table.Cell>
								</Table.Row>
							{/if}

							<!-- Vocabulary Type -->
							{#if modelMeta?.vocab_type}
								<Table.Row>
									<Table.Cell class="align-middle font-medium">Vocabulary Type</Table.Cell>

									<Table.Cell class="align-middle capitalize">{modelMeta.vocab_type}</Table.Cell>
								</Table.Row>
							{/if}

							<!-- Total Slots -->
							<Table.Row>
								<Table.Cell class="align-middle font-medium">Parallel Slots</Table.Cell>

								<Table.Cell>{serverProps.total_slots}</Table.Cell>
							</Table.Row>

							<!-- Modalities -->
							{#if modalities.length > 0}
								<Table.Row>
									<Table.Cell class="align-middle font-medium">Modalities</Table.Cell>

									<Table.Cell>
										<div class="flex flex-wrap gap-1">
											<BadgesModality {modalities} />
										</div>
									</Table.Cell>
								</Table.Row>
							{/if}

							<!-- Build Info -->
							<Table.Row>
								<Table.Cell class="align-middle font-medium">Build Info</Table.Cell>

								<Table.Cell class="align-middle font-mono text-xs"
									>{serverProps.build_info}</Table.Cell
								>
							</Table.Row>

							<!-- Chat Template -->
							{#if serverProps.chat_template}
								<Table.Row>
									<Table.Cell class="py-4" colspan={2}>
										<div class="flex flex-col gap-2">
											<span class="font-medium">Chat Template</span>

											<div class="overflow-x-auto rounded-md bg-muted p-4">
												<pre
													class="font-mono text-xs whitespace-pre">{serverProps.chat_template}</pre>
											</div>
										</div>
									</Table.Cell>
								</Table.Row>
							{/if}
						</Table.Body>
					</Table.Root>

					<!-- Mobile: stacked layout; long values wrap instead of scrolling the page -->
					<div class="flex min-w-0 flex-col gap-4 md:hidden">
						<div class="min-w-0 space-y-1">
							<div class="text-xs font-medium text-muted-foreground">Model</div>

							<div class="flex min-w-0 items-start gap-2">
								<span class="min-w-0 flex-1 break-all font-mono text-xs">{modelName}</span>

								<ActionIconCopyToClipboard
									ariaLabel="Copy model name to clipboard"
									canCopy={!!modelName}
									text={modelName || ''}
								/>
							</div>
						</div>

						<div class="min-w-0 space-y-1">
							<div class="text-xs font-medium text-muted-foreground">File Path</div>

							<div class="flex min-w-0 items-start gap-2">
								<span class="min-w-0 flex-1 break-all font-mono text-xs"
									>{serverProps.model_path}</span
								>

								<ActionIconCopyToClipboard
									ariaLabel="Copy model path to clipboard"
									text={serverProps.model_path}
								/>
							</div>
						</div>

						{#if contextSize !== null}
							{@render infoRow('Context Size', `${formatNumber(contextSize)} tokens`)}
						{:else}
							{@render infoRow('Context Size', 'Not available', 'text-red-500')}
						{/if}

						{#if modelMeta?.n_ctx_train}
							{@render infoRow('Training Context', `${formatNumber(modelMeta.n_ctx_train)} tokens`)}
						{/if}

						{#if modelMeta?.size}
							{@render infoRow('Model Size', formatFileSize(modelMeta.size))}
						{/if}

						{#if modelMeta?.n_params}
							{@render infoRow('Parameters', formatParameters(modelMeta.n_params))}
						{/if}

						{#if modelMeta?.n_embd}
							{@render infoRow('Embedding Size', formatNumber(modelMeta.n_embd))}
						{/if}

						{#if modelMeta?.n_vocab}
							{@render infoRow('Vocabulary Size', `${formatNumber(modelMeta.n_vocab)} tokens`)}
						{/if}

						{#if modelMeta?.vocab_type}
							{@render infoRow('Vocabulary Type', modelMeta.vocab_type, 'capitalize')}
						{/if}

						{@render infoRow('Parallel Slots', `${serverProps.total_slots}`)}

						{#if modalities.length > 0}
							<div class="min-w-0 space-y-1">
								<div class="text-xs font-medium text-muted-foreground">Modalities</div>

								<div class="flex flex-wrap gap-1">
									<BadgesModality {modalities} />
								</div>
							</div>
						{/if}

						<div class="min-w-0 space-y-1">
							<div class="text-xs font-medium text-muted-foreground">Build Info</div>

							<span class="block break-all font-mono text-xs">{serverProps.build_info}</span>
						</div>

						{#if serverProps.chat_template}
							<div class="min-w-0 space-y-2">
								<div class="text-xs font-medium text-muted-foreground">Chat Template</div>

								<div class="overflow-x-auto rounded-md bg-muted p-4">
									<pre class="font-mono text-xs whitespace-pre">{serverProps.chat_template}</pre>
								</div>
							</div>
						{/if}
					</div>
				{:else}
					<!-- OpenAI-compatible backend (e.g. vllm): no /props, so show what the
					     model entry itself advertises (modalities, context window, capabilities) -->
					<Table.Root class="hidden table-fixed md:table">
						<Table.Header>
							<Table.Row>
								<Table.Head class="w-[10rem]">Model</Table.Head>

								<Table.Head>
									<div class="flex min-w-0 items-center gap-2">
										<span class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">
											{modelName}
										</span>

										<ActionIconCopyToClipboard
											ariaLabel="Copy model name to clipboard"
											canCopy={!!modelName}
											text={modelName || ''}
										/>
									</div>
								</Table.Head>
							</Table.Row>
						</Table.Header>

						<Table.Body>
							{#if firstModel.id && firstModel.id !== modelName}
								<Table.Row>
									<Table.Cell class="h-10 align-middle font-medium">Model ID</Table.Cell>

									<Table.Cell class="h-10 align-middle font-mono text-xs">
										<div class="flex min-w-0 items-center gap-2">
											<span class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">
												{firstModel.id}
											</span>

											<ActionIconCopyToClipboard
												ariaLabel="Copy model ID to clipboard"
												text={firstModel.id}
											/>
										</div>
									</Table.Cell>
								</Table.Row>
							{/if}

							<!-- Context Size -->
							{#if contextSize !== null}
								<Table.Row>
									<Table.Cell class="h-10 align-middle font-medium">Context Size</Table.Cell>

									<Table.Cell>{formatNumber(contextSize)} tokens</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row>
									<Table.Cell class="h-10 align-middle font-medium">Context Size</Table.Cell>

									<Table.Cell class="text-muted-foreground">Not reported by this backend</Table.Cell>
								</Table.Row>
							{/if}

							<!-- Modalities -->
							{#if modalities.length > 0}
								<Table.Row>
									<Table.Cell class="align-middle font-medium">Input Modalities</Table.Cell>

									<Table.Cell>
										<div class="flex flex-wrap gap-1">
											<BadgesModality {modalities} />
										</div>
									</Table.Cell>
								</Table.Row>
							{/if}

							<!-- Capabilities advertised by the API entry -->
							{#if capabilities.length > 0}
								<Table.Row>
									<Table.Cell class="align-middle font-medium">Capabilities</Table.Cell>

									<Table.Cell>
										<div class="flex flex-wrap gap-1">
											{#each capabilities as cap (cap.key)}
												<span
													class="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-medium"
												>
													{cap.label}
												</span>
											{/each}
										</div>
									</Table.Cell>
								</Table.Row>
							{/if}

							<!-- Performance of the most recent response (client-measured) -->
							{#if lastSpeed}
								<Table.Row>
									<Table.Cell class="h-10 align-middle font-medium">Prefill</Table.Cell>

									<Table.Cell class="h-10 align-middle">
										<span class="font-mono text-xs">{lastSpeed.prefillMs ?? '—'}</span> ms
										{#if lastSpeed.prefillSpeed}
											<span class="ml-2 text-muted-foreground">
												({lastSpeed.prefillSpeed} tok/s)
											</span>
										{/if}
									</Table.Cell>
								</Table.Row>
							{/if}

							{#if lastSpeed}
								<Table.Row>
									<Table.Cell class="h-10 align-middle font-medium">Prompt tokens</Table.Cell>

									<Table.Cell class="h-10 align-middle">
										<span class="font-mono text-xs">{formatNumber(lastSpeed.promptTokens ?? 0)}</span>
									</Table.Cell>
								</Table.Row>
							{/if}

							{#if lastSpeed}
								<Table.Row>
									<Table.Cell class="h-10 align-middle font-medium">Output tokens</Table.Cell>

									<Table.Cell class="h-10 align-middle">
										<span class="font-mono text-xs">{formatNumber(lastSpeed.outputTokens ?? 0)}</span>
									</Table.Cell>
								</Table.Row>
							{/if}

							{#if lastSpeed?.genSpeed}
								<Table.Row>
									<Table.Cell class="h-10 align-middle font-medium">Generation speed</Table.Cell>

									<Table.Cell class="h-10 align-middle">
										<span class="font-mono text-xs">{lastSpeed.genSpeed}</span> tok/s
									</Table.Cell>
								</Table.Row>
							{/if}

							<!-- Backend -->
							{#if firstModel.ownedBy}
								<Table.Row>
									<Table.Cell class="align-middle font-medium">Backend</Table.Cell>

									<Table.Cell class="align-middle capitalize">{firstModel.ownedBy}</Table.Cell>
								</Table.Row>
							{/if}
						</Table.Body>
					</Table.Root>

					<!-- Mobile: stacked layout -->
					<div class="flex min-w-0 flex-col gap-4 md:hidden">
						<div class="min-w-0 space-y-1">
							<div class="text-xs font-medium text-muted-foreground">Model</div>

							<div class="flex min-w-0 items-start gap-2">
								<span class="min-w-0 flex-1 break-all font-mono text-xs">{modelName}</span>

								<ActionIconCopyToClipboard
									ariaLabel="Copy model name to clipboard"
									canCopy={!!modelName}
									text={modelName || ''}
								/>
							</div>
						</div>

						{#if firstModel.id && firstModel.id !== modelName}
							<div class="min-w-0 space-y-1">
								<div class="text-xs font-medium text-muted-foreground">Model ID</div>

								<div class="flex min-w-0 items-start gap-2">
									<span class="min-w-0 flex-1 break-all font-mono text-xs">{firstModel.id}</span>

									<ActionIconCopyToClipboard
										ariaLabel="Copy model ID to clipboard"
										text={firstModel.id}
									/>
								</div>
							</div>
						{/if}

						{#if contextSize !== null}
							{@render infoRow('Context Size', `${formatNumber(contextSize)} tokens`)}
						{:else}
							{@render infoRow('Context Size', 'Not reported by this backend')}
						{/if}

						{#if modalities.length > 0}
							<div class="min-w-0 space-y-1">
								<div class="text-xs font-medium text-muted-foreground">Input Modalities</div>

								<div class="flex flex-wrap gap-1">
									<BadgesModality {modalities} />
								</div>
							</div>
						{/if}

						{#if capabilities.length > 0}
							<div class="min-w-0 space-y-1">
								<div class="text-xs font-medium text-muted-foreground">Capabilities</div>

								<div class="flex flex-wrap gap-1">
									{#each capabilities as cap (cap.key)}
										<span
											class="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-medium"
										>
											{cap.label}
										</span>
									{/each}
								</div>
							</div>
						{/if}

						{#if lastSpeed}
							<div class="min-w-0 space-y-1">
								<div class="text-xs font-medium text-muted-foreground">Prefill (last response)</div>

								<div class="font-mono text-xs">
									{lastSpeed.prefillMs ?? '—'} ms
									{#if lastSpeed.prefillSpeed}
										<span class="text-muted-foreground"> ({lastSpeed.prefillSpeed} tok/s)</span>
									{/if}
								</div>
							</div>

							{@render infoRow('Prompt tokens', formatNumber(lastSpeed.promptTokens ?? 0))}
							{@render infoRow('Output tokens', formatNumber(lastSpeed.outputTokens ?? 0))}

							{#if lastSpeed.genSpeed}
								{@render infoRow('Generation speed', `${lastSpeed.genSpeed} tok/s`)}
							{/if}
						{/if}

						{#if firstModel.ownedBy}
							{@render infoRow('Backend', firstModel.ownedBy, 'capitalize')}
						{/if}
					</div>
				{/if}
			{:else if !isLoadingModels}
				<div class="flex items-center justify-center py-8">
					<div class="text-sm text-muted-foreground">No model information available</div>
				</div>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>

{#snippet infoRow(label: string, value: string, valueClass: string = '')}
	<div class="flex items-center justify-between gap-3">
		<span class="shrink-0 text-xs font-medium text-muted-foreground {valueClass}">{label}</span>

		<span class="text-sm {valueClass}">{value}</span>
	</div>
{/snippet}
