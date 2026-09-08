import { resolveApiUrl } from '$lib/utils/api-base';

// Every endpoint below is resolved LAZILY (via getters) against the
// runtime-configurable API base (see $lib/utils/api-base). Using getters
// instead of baked constants means the base is read at ACCESS time, so changing
// the endpoint in Settings → API endpoint takes effect immediately — no page
// reload required. With no base configured, resolveApiUrl() returns the path
// unchanged, preserving the original same-origin behavior. When a custom base is
// set, all of these point at that endpoint, letting this UI test token speed
// against any backend (a llama.cpp server, or an OpenAI-compatible vllm/qwen).
export const API_MODELS = {
	get LIST() {
		return resolveApiUrl('/v1/models');
	},
	get LOAD() {
		return resolveApiUrl('/models/load');
	},
	get SSE() {
		return resolveApiUrl('/models/sse');
	},
	get UNLOAD() {
		return resolveApiUrl('/models/unload');
	}
};

// chat completion routes, the control route drives realtime inference (e.g. end reasoning)
export const API_CHAT = {
	get COMPLETIONS() {
		return resolveApiUrl('./v1/chat/completions');
	},
	get CONTROL() {
		return resolveApiUrl('./v1/chat/completions/control');
	}
};

// slot introspection, requires the --slots flag on the server
export const API_SLOTS = {
	get LIST() {
		return resolveApiUrl('./slots');
	}
};

export const API_TOOLS = {
	get EXECUTE() {
		return resolveApiUrl('/tools');
	},
	get LIST() {
		return resolveApiUrl('/tools');
	}
};

// resumable stream routes, the conv::model identity travels as the conv_id query param
// because model names can contain slashes that a path segment cannot carry
// resume retry cadence while the owning model is still loading (server answers 503)
export const STREAM_RESUME_RETRY_MS = 2000;

export const API_STREAM = {
	get BASE() {
		return resolveApiUrl('./v1/stream');
	},
	get LOOKUP() {
		return resolveApiUrl('./v1/streams/lookup');
	}
};

// query params for the resumable stream routes
export const STREAM_QUERY_PARAMS = {
	CONV_ID: 'conv_id',
	FROM: 'from'
} as const;

/** CORS proxy endpoint path (always same-origin: it is the local server's proxy) */
export const CORS_PROXY_ENDPOINT = '/cors-proxy';
