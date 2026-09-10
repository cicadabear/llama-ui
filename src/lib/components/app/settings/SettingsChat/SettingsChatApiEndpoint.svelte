<script lang="ts">
	import { Eye, EyeOff } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import Label from '$lib/components/ui/label/label.svelte';
	import { ICON_CLASS_DEFAULT, SETTINGS_KEYS } from '$lib/constants';
	import { modelsStore, settingsStore } from '$lib/stores';
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

	// ── API key ────────────────────────────────────────────────────────────
	// The key lives in the settings store (config.apiKey) so getAuthHeaders()
	// sends it as `Authorization: Bearer <key>` on every request (chat, stream,
	// models). Masked by default; the eye button reveals it temporarily.
	// Auto-saved to this browser's localStorage whenever it changes.
	//
	// NOTE: this field is the sole owner of config.apiKey. The settings
	// "Save" button (SettingsChat.handleSave) excludes apiKey from its
	// bulk write so it cannot clobber what is typed here.
	let key = $state(
		(settingsStore.config[SETTINGS_KEYS.API_KEY] as string | undefined) ?? ''
	);
	let showKey = $state(false);

	function toggleKeyVisibility() {
		showKey = !showKey;
	}

	// Push the typed key to the store (and localStorage) when it diverges.
	$effect(() => {
		const storeKey =
			(settingsStore.config[SETTINGS_KEYS.API_KEY] as string | undefined) ?? '';
		const next = key.trim();
		if (storeKey !== next) {
			settingsStore.updateConfig(SETTINGS_KEYS.API_KEY, next);
		}
	});

	// ── endpoint ───────────────────────────────────────────────────────────
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

	<!-- API key: masked by default, eye button to reveal -->
	<div class="mt-3 space-y-1.5 border-t border-border/40 pt-3">
		<Label for="api-key" class="font-medium">
			API key <span class="font-normal text-muted-foreground">(optional)</span>
		</Label>
		<div class="relative">
			<Input
				id="api-key"
				bind:value={key}
				type={showKey ? 'text' : 'password'}
				autocomplete="new-password"
				placeholder="Bearer key (if your endpoint requires one)"
				class="pr-9 font-mono text-sm"
			/>
			<button
				type="button"
				aria-label={showKey ? 'Hide API key' : 'Show API key'}
				class="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
				onclick={toggleKeyVisibility}
			>
				{#if showKey}
					<EyeOff class={ICON_CLASS_DEFAULT} />
				{:else}
					<Eye class={ICON_CLASS_DEFAULT} />
				{/if}
			</button>
		</div>
		<p class="text-xs text-muted-foreground">
			Sent as <code>Authorization: Bearer &lt;key&gt;</code>. Stored only in this
			browser (localStorage); it is never included in settings exports and is
			redacted from logs.
		</p>
	</div>

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
							{#if i === 0}
								<span class="text-[10px] uppercase text-muted-foreground">first</span>
							{/if}
						</label>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if status}
		<p
			class="text-xs {status.startsWith('Could not') || status.startsWith('Connected, but') ? 'text-destructive' : 'text-muted-foreground'}"
		>
			{status}
		</p>
	{/if}
</div>
