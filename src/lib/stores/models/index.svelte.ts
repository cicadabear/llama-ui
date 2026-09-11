/**
 * modelsStore - Model management for MODEL and ROUTER modes
 *
 * Owns model lists, selection, favorites and load/unload state. Composes the
 * per-model props cache (modalities, thinking detection) as
 * {@link ModelsStore.props} and the /models/sse status feed as
 * {@link ModelsStore.status}; tracks which conversations use which models.
 */

import { FAVORITE_MODELS_LOCALSTORAGE_KEY } from '$lib/constants';
import { FileTypeCategory, ServerModelStatus } from '$lib/enums';
import { ModelsService } from '$lib/services/models.service';
// direct imports between stores, not via the barrel, to avoid circular deps
import { conversationsStore } from '$lib/stores/conversations/index.svelte';
import { type ModelPropsHost, ModelPropsManager } from '$lib/stores/models/props.svelte';
import { type ModelStatusHost, ModelStatusManager } from '$lib/stores/models/status.svelte';
import { serverStore } from '$lib/stores/server.svelte';
import { getConversationModel } from '$lib/utils/conversation-utils';
import { SvelteSet } from 'svelte/reactivity';
import { toast } from 'svelte-sonner';

class ModelsStore implements ModelPropsHost, ModelStatusHost {
	error = $state<string | null>(null);
	favoriteModelIds = $state<Set<string>>(this.loadFavoritesFromStorage());
	loading = $state(false);
	models = $state<ModelOption[]>([]);
	routerModels = $state<ApiModelDataEntry[]>([]);
	selectedModelId = $state<string | null>(null);
	selectedModelName = $state<string | null>(null);

	updating = $state(false);

	/** Per-model props cache, modalities and thinking detection, composed here. */
	private _props = new ModelPropsManager(this);

	/** Load/unload operations and the /models/sse status feed, composed here. */
	private _status = new ModelStatusManager(this);

	// Dedup concurrent fetch() callers — all awaiters share the same inflight promise.
	// Without this, ?model=<name> URL handler races an in-progress fetch and sees an empty list.
	private inflightFetch: Promise<void> | null = null;

	/**
	 * Model the active conversation view resolves to. Router mode: the user's
	 * selection first, then the conversation's own model. Otherwise the single
	 * served model, from the models list or the server props as a fallback.
	 */
	get activeModelId(): string | null {
		if (!serverStore.isRouterMode) {
			return this.models.length > 0 ? this.models[0].model : this.singleModelName;
		}

		if (this.selectedModelId) {
			const selected = this.models.find((m) => m.id === this.selectedModelId);

			if (selected) return selected.model;
		}

		const conversationModel = getConversationModel(conversationsStore.activeMessages);

		if (conversationModel) {
			const model = this.models.find((m) => m.model === conversationModel);

			if (model) return model.model;
		}

		return null;
	}

	get loadedModelIds(): string[] {
		return this.routerModels
			.filter(
				(m) =>
					m.status?.value === ServerModelStatus.LOADED ||
					m.status?.value === ServerModelStatus.SLEEPING
			)
			.map((m) => m.id);
	}

	get props() {
		return this._props;
	}

	get selectedModel(): ModelOption | null {
		if (!this.selectedModelId) return null;

		return this.models.find((m) => m.id === this.selectedModelId) ?? null;
	}

	get selectedModelContextSize(): number | null {
		if (!this.selectedModelName) return null;

		return this.props.getModelContextSize(this.selectedModelName);
	}

	/**
	 * Get model name in MODEL mode (single model).
	 * Extracts from model_path or model_alias from server props.
	 * In ROUTER mode, returns null (model is per-conversation).
	 */
	get singleModelName(): string | null {
		if (serverStore.isRouterMode) return null;

		const props = serverStore.props;

		if (props?.model_alias) return props.model_alias;

		if (!props?.model_path) return null;

		return props.model_path.split(/(\\|\/)/).pop() || null;
	}

	get status() {
		return this._status;
	}

	clearSelection(): void {
		this.selectedModelId = null;
		this.selectedModelName = null;
	}

	/**
	 * Auto-selects the first available model if none is selected.
	 * Prioritizes:
	 * 1. Model from active conversation's last assistant response (if loaded)
	 * 2. Model from active conversation's last assistant response (if not loaded)
	 * 3. First loaded model (not from active conversation)
	 * 4. A favorite model
	 * 5. First available model
	 */
	async ensureFirstModelSelected(): Promise<void> {
		if (this.selectedModelName) return;

		const availableModels = this.getVisibleModels();

		if (availableModels.length === 0) return;

		// Try to select model from last assistant response first
		const lastModel = this.getModelFromLastAssistantResponse();

		if (lastModel) {
			const lastModelOption = availableModels.find((m) => m.model === lastModel);

			if (lastModelOption) {
				await this.selectModelById(lastModelOption.id);

				if (this.isModelLoaded(lastModel)) {
					await this.props.fetchModelProps(lastModel);
				}

				return;
			}
		}

		// Try a loaded model first
		const loadedModel = availableModels.find((m) => this.isModelLoaded(m.model));

		if (loadedModel) {
			await this.selectModelById(loadedModel.id);
			await this.props.fetchModelProps(loadedModel.model);

			return;
		}

		// Try loading a favorite model
		const favorite = this.favoriteModelIds.values().next()?.value;

		if (favorite) {
			await this.selectModelById(favorite);

			return;
		}

		// Fall back to the first available model
		await this.selectModelById(availableModels[0].id);
	}

	/**
	 * Fetch list of models from server and detect server role.
	 * Also fetches modalities for MODEL mode (single model).
	 */
	async fetch(force = false): Promise<void> {
		if (this.inflightFetch) return this.inflightFetch;

		if (this.models.length > 0 && !force) return;

		this.inflightFetch = this.runFetch();
		try {
			await this.inflightFetch;
		} catch {
			// runFetch already stores the message in this.error. Swallow the
			// rethrow here so fire-and-forget callers (e.g. the initial load
			// before an API endpoint is configured) don't surface an unhandled
			// rejection; callers can still inspect modelsStore.error.
		} finally {
			this.inflightFetch = null;
		}
	}

	/**
	 * Fetch router models with full metadata (ROUTER mode only).
	 * No-op in router mode — fetch() already calls listRouter() internally.
	 * Kept for API compatibility (e.g. handleOpenChange dropdown open handler).
	 */
	async fetchRouterModels(): Promise<void> {
		if (!serverStore.isRouterMode) return;

		try {
			const response = await ModelsService.listRouter();

			this.routerModels = response.data;
			await this.props.fetchModalitiesForLoadedModels();

			const visible = this.getVisibleModels();

			if (visible.length === 1 && this.isModelLoaded(visible[0].model)) {
				this.selectModelById(visible[0].id);
			}
		} catch (error) {
			console.warn('Failed to fetch router models:', error);
			this.routerModels = [];
		}
	}

	findModelById(modelId: string): ModelOption | null {
		return this.models.find((model) => model.id === modelId) ?? null;
	}

	findModelByName(modelName: string): ModelOption | null {
		return (
			this.models.find(
				(model) =>
					model.model === modelName || model.id === modelName || model.aliases?.includes(modelName)
			) ?? null
		);
	}

	/**
	 * Gets the model name from the last assistant message in the active conversation.
	 * Used by both the chat page and settings page to maintain model consistency.
	 */
	getModelFromLastAssistantResponse(): string | null {
		const messages = conversationsStore.activeMessages;

		if (!messages || messages.length === 0) return null;

		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].model) {
				return messages[i].model;
			}
		}

		return null;
	}

	getModelStatus(modelId: string): ServerModelStatus | null {
		const model = this.routerModels.find((m) => m.id === modelId);

		return model?.status?.value ?? null;
	}

	hasModel(modelName: string): boolean {
		return this.models.some((model) => model.model === modelName);
	}

	isFavorite(modelId: string): boolean {
		return this.favoriteModelIds.has(modelId);
	}

	isModelLoaded(modelId: string): boolean {
		const model = this.routerModels.find((m) => m.id === modelId);

		return (
			model?.status?.value === ServerModelStatus.LOADED ||
			model?.status?.value === ServerModelStatus.SLEEPING
		);
	}

	async selectModelById(modelId: string): Promise<void> {
		if (!modelId || this.updating) return;

		if (this.selectedModelId === modelId) return;

		const option = this.models.find((model) => model.id === modelId);

		if (!option) throw new Error('Selected model is not available');

		this.updating = true;
		this.error = null;

		try {
			this.selectedModelId = option.id;
			this.selectedModelName = option.model;
		} finally {
			this.updating = false;
		}
	}

	/**
	 * Select a model by its model name (used for syncing with conversation model).
	 */
	selectModelByName(modelName: string): void {
		const option = this.models.find((model) => model.model === modelName);

		if (option) {
			this.selectedModelId = option.id;
			this.selectedModelName = option.model;
		}
	}

	/**
	 * Auto-selects the model from the last assistant response if available and loaded.
	 * Returns true if a model was selected, false otherwise.
	 */
	async selectModelFromLastAssistantResponse(): Promise<boolean> {
		const lastModel = this.getModelFromLastAssistantResponse();

		if (!lastModel || this.selectedModelName === lastModel) return false;

		const matchingModel = this.models.find((option) => option.model === lastModel);

		if (!matchingModel || !this.isModelLoaded(lastModel)) return false;

		try {
			await this.selectModelById(matchingModel.id);
			console.log(`[modelsStore] Automatically selected model: ${lastModel} from last message`);

			return true;
		} catch (error) {
			console.warn('[modelsStore] Failed to automatically select model from last message:', error);

			return false;
		}
	}

	toDisplayName(id: string): string {
		const segments = id.split(/\\|\//);
		const candidate = segments.pop();

		return candidate && candidate.trim().length > 0 ? candidate : id;
	}

	toggleFavorite(modelId: string): void {
		const next = new SvelteSet(this.favoriteModelIds);

		if (next.has(modelId)) {
			next.delete(modelId);
		} else {
			next.add(modelId);
		}

		this.favoriteModelIds = next;

		try {
			localStorage.setItem(FAVORITE_MODELS_LOCALSTORAGE_KEY, JSON.stringify([...next]));
		} catch {
			toast.error('Failed to save favorite models to local storage');
		}
	}

	/**
	 * Build ModelOption[] from an API response.
	 * Both MODEL and ROUTER modes share the same mapping logic;
	 * they differ only in which endpoint is called.
	 */
	private buildModelOptions(
		response: ApiModelListResponse | ApiRouterModelsListResponse
	): ModelOption[] {
		return response.data.map((item: ApiModelDataEntry, index: number) => {
			const details = response.models?.[index];
			const rawCapabilities = Array.isArray(details?.capabilities) ? details?.capabilities : [];
			const displayName =
				item.display_name && item.display_name.trim().length > 0
					? item.display_name
					: details?.name && details.name.trim().length > 0
						? details.name
						: item.id;
			const modelId = details?.model || item.id;
			const maxModelLen = this.parseModelContextLength(item);
			const openaiCapabilities =
				item.capabilities && typeof item.capabilities === 'object' ? item.capabilities : undefined;

			return {
				aliases: item.aliases ?? [],
				capabilities: rawCapabilities.filter((value: unknown): value is string => Boolean(value)),
				description: details?.description,
				displayName,
				details: details?.details,
				id: item.id,
				maxModelLen,
				meta: item.meta ?? null,
				modalities: this.buildEntryModalities(item, this.props),
				model: modelId,
				name: this.toDisplayName(displayName),
				openaiCapabilities,
				ownedBy: typeof item.owned_by === 'string' && item.owned_by ? item.owned_by : undefined,
				parsedId: ModelsService.parseModelId(modelId),
				tags: item.tags ?? []
			};
		});
	}

	/**
	 * Read a model entry's declared input modalities into the {vision,audio,video}
	 * flag object. llama.cpp reports them under `architecture.input_modalities`;
	 * a plain OpenAI-compatible backend (e.g. vllm) reports them as
	 * `input_modalities` / `modalities.input`. Returns undefined when the entry
	 * advertises no input modalities at all (a llama.cpp entry with no
	 * `architecture` and no OpenAI fields), so the caller can keep its fallback.
	 */
	private buildEntryModalities(
		item: ApiModelDataEntry,
		props: ModelsStore['props']
	): ModelModalities | undefined {
		const inputs = this.entryInputModalities(item);

		if (inputs.length === 0) {
			return props.buildArchitectureModalities(item.architecture);
		}

		return {
			audio: inputs.includes(FileTypeCategory.AUDIO),
			video: inputs.includes(FileTypeCategory.VIDEO),
			vision: inputs.includes(FileTypeCategory.IMAGE)
		};
	}

	/**
	 * Collect the input-modality strings a model entry advertises, in priority
	 * order: the OpenAI-standard `input_modalities`, then the nested
	 * `modalities.input`, then llama.cpp's `architecture.input_modalities`.
	 */
	private entryInputModalities(item: ApiModelDataEntry): string[] {
		const sources = [
			item.input_modalities,
			item.modalities?.input,
			item.architecture?.input_modalities
		];

		for (const source of sources) {
			if (Array.isArray(source) && source.length > 0) return source;
		}

		return [];
	}

	/**
	 * Read the model's maximum context length in tokens from an OpenAI-compatible
	 * entry (`max_model_len`, falling back to `context_window` /
	 * `context_length`). Returns null when the entry reports none.
	 */
	private parseModelContextLength(item: ApiModelDataEntry): number | null {
		for (const value of [item.max_model_len, item.context_window, item.context_length]) {
			if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
		}

		return null;
	}

	/** Fetch models in MODEL mode (single model, standard OpenAI-compatible). */
	private async fetchModelModeInternal(): Promise<ModelOption[]> {
		const response = await ModelsService.list();

		return this.buildModelOptions(response);
	}

	/**
	 * Filter to models visible in the UI (ui !== false).
	 */
	private getVisibleModels(): ModelOption[] {
		return this.models.filter((option) => this.props.getModelProps(option.model)?.ui !== false);
	}

	private loadFavoritesFromStorage(): Set<string> {
		try {
			const raw = localStorage.getItem(FAVORITE_MODELS_LOCALSTORAGE_KEY);

			return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
		} catch {
			toast.error('Failed to load favorite models from local storage');

			return new Set();
		}
	}

	private async runFetch(): Promise<void> {
		this.loading = true;
		this.error = null;

		try {
			if (!serverStore.props) {
				await serverStore.fetch();
			}

			const router = serverStore.isRouterMode;

			if (router) {
				const response = await ModelsService.listRouter();

				this.routerModels = response.data;
				this.models = this.buildModelOptions(response);

				await this.props.fetchModalitiesForLoadedModels();

				const visible = this.getVisibleModels();

				if (visible.length === 1 && this.isModelLoaded(visible[0].model)) {
					this.selectModelById(visible[0].id);
				}
			} else {
				this.models = await this.fetchModelModeInternal();

				// Auto-select the first model when the list comes from a
				// non-router (single-model, e.g. vllm) backend so the model
				// picker shows a model right away.
				if (this.models.length > 0) {
					await this.ensureFirstModelSelected();
				}
			}
		} catch (error) {
			this.models = [];
			this.error = error instanceof Error ? error.message : 'Failed to load models';
			// Do not rethrow: runFetch's promise is shared via inflightFetch with
			// multiple (sometimes fire-and-forget) callers, and a rethrow would
			// surface as an unhandled rejection. The message is preserved here.
		} finally {
			this.loading = false;
		}
	}
}

export const modelsStore = new ModelsStore();
