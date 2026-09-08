<script lang="ts">
	/**
	 * Small control to point the UI at a custom API endpoint for speed testing.
	 *
	 * Clicking it reveals an input where you paste a base URL (e.g.
	 * `http://192.168.32.27:8000` for a vllm/OpenAI endpoint, or another
	 * llama.cpp server). "Set" applies it (persisted + applied via ?api= and a
	 * reload); "Clear" returns to the same-origin server.
	 */
	import { getApiBase, setApiBase } from '$lib/utils/api-base';

	let current = $derived(getApiBase());
	let editing = $state(false);
	let draft = $state('');

	function startEdit() {
		draft = current;
		editing = true;
	}

	function apply() {
		setApiBase(draft.trim() ? draft.trim() : null);
	}

	function clear() {
		setApiBase(null);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') apply();
		if (e.key === 'Escape') editing = false;
	}

	function autofocus(node: HTMLInputElement) {
		// focus the field when it is revealed (a bare `autofocus` attribute
		// trips Svelte's a11y checker, so we do it as an action instead)
		node.focus();
	}

	const short = (u: string) => u.replace(/^https?:\/\//, '');
</script>

<div class="api-badge" title="Point this UI at a custom API endpoint (any host:port) to test token speed">
	{#if editing}
		<span class="label">API</span>
		<input
			type="text"
			bind:value={draft}
			placeholder="http://host:port   (blank = same origin)"
			onkeydown={onKeydown}
			use:autofocus
		/>
		<button type="button" class="primary" onclick={apply}>Set</button>
		<button type="button" onclick={clear}>Clear</button>
	{:else}
		<button type="button" class="chip" onclick={startEdit} title="Configure the custom API endpoint">
			<span aria-hidden="true">🎛</span>
			API: {current ? short(current) : 'same origin'}
		</button>
	{/if}
</div>

<style>
	.api-badge {
		display: inline-flex;
		gap: 0.35rem;
		align-items: center;
		font-size: 0.8rem;
	}
	.label {
		font-weight: 600;
		opacity: 0.7;
	}
	.chip {
		cursor: pointer;
		padding: 0.2rem 0.55rem;
		border-radius: 0.5rem;
		border: 1px solid var(--color-border, rgba(128, 128, 128, 0.3));
		background: var(--color-background, transparent);
		opacity: 0.9;
	}
	.chip:hover {
		opacity: 1;
		border-color: var(--color-primary, #2563eb);
	}
	input {
		padding: 0.2rem 0.45rem;
		border-radius: 0.4rem;
		border: 1px solid var(--color-border, rgba(128, 128, 128, 0.35));
		min-width: 220px;
		font-size: 0.8rem;
	}
	button {
		cursor: pointer;
		padding: 0.2rem 0.5rem;
		border-radius: 0.4rem;
		border: 1px solid var(--color-border, rgba(128, 128, 128, 0.3));
		font-size: 0.75rem;
	}
	.primary {
		background: var(--color-primary, #2563eb);
		color: #fff;
		border-color: var(--color-primary, #2563eb);
	}
</style>
