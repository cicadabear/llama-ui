<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import Label from '$lib/components/ui/label/label.svelte';
	import { modelsStore } from '$lib/stores';
	import { getApiBase, persistApiBase } from '$lib/utils/api-base';

	// Seeded from the remembered endpoint (localStorage). Changes are committed
	// with "Apply", which persists the base and loads its models live — no reload.
	let value = $state(getApiBase());
	let busy = $state(false);
	let status = $state('');

	// Read straight from the store so this list always matches the main model
	// selector and the auto-selection.
	const models = $derived(modelsStore.models);
	const selectedId = $derived(modelsStore.selectedModelId);

	async function apply() {
		const v = value.trim();
		busy = true;
		status = '';
		try {
			persistApiBase(v); // persist WITHOUT reloading (the base is read live)
			status = 'Connecting…';
			await modelsStore.fetch(true); // re-fetch from the (new) base, auto-selects first
			if (modelsStore.models.length > 0) {
				status = `Connected — ${modelsStore.models.length} model(s); the first one is selected.`;
			} else if (modelsStore.error) {
				status = `Could not load models: ${modelsStore.error}`;
			} else {
				status = 'Connected, but the endpoint listed no models.';
			}
		} catch (e: any) {
			status = `Could not reach "${v}": ${e?.message || e}`;
		} finally {
			busy = false;
		}
	}

	function clear() {
		value = '';
		persistApiBase('');
		modelsStore.models = [];
		modelsStore.clearSelection();
		status = 'Cleared — using the same origin as this page.';
	}

	function pick(id: string) {
		modelsStore.selectModelById(id);
	}

	// When this panel opens with an endpoint already configured, show its models.
	if (getApiBase()) void modelsStore.fetch();
</script>

<div class="space-y-2 rounded-md border border-border/60 p-3">
	<Label for="api-endpoint" class="font-medium">API endpoint</Label>
	<Input
		id="api-endpoint"
		type="url"
		bind:value={value}
		placeholder="http://192.168.32.27:8000"
		class="font-mono text-sm"
	/>
	<p class="text-xs text-muted-foreground">
		Base URL of the model API to test (a llama.cpp server, or any OpenAI-compatible
		endpoint such as vllm / LM Studio). A trailing <code>/v1</code> is handled
		automatically. The browser calls it directly, so it must allow cross-origin
		requests (CORS). Leave empty to use the same origin as this page.
	</p>
	<div class="flex items-center justify-end gap-2">
		<Button type="button" variant="outline" disabled={busy} onclick={clear}>Clear</Button>
		<Button type="button" disabled={busy} onclick={apply}>{busy ? 'Applying…' : 'Apply'}</Button>
	</div>

	{#if models.length > 0}
		<div class="mt-2 rounded-md border border-border/50 p-2">
			<p class="mb-1 text-xs font-medium text-muted-foreground">
				Models from this endpoint — the first is auto-selected
			</p>
			<ul class="max-h-52 space-y-0.5 overflow-y-auto pr-1">
				{#each models as m, i (m.id)}
					<li>
						<label
							class="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent/40"
							title={m.id}
						>
							<input
								type="radio"
								name="api-endpoint-model"
								value={m.id}
								checked={selectedId === m.id}
								onchange={() => pick(m.id)}
							/>
							<span class="flex-1 truncate">{m.name || m.model}</span>
							{#if i === 0}<span class="text-[10px] uppercase text-muted-foreground">first</span>{/if}
						</label>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if status}
		<p class="text-xs {status.startsWith('Could not') || status.startsWith('Connected, but') ? 'text-destructive' : 'text-muted-foreground'}">
			{status}
		</p>
	{/if}
</div>
