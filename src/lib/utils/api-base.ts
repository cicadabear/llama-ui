/**
 * Runtime-configurable API base URL for the llama.cpp web UI.
 *
 * By default the UI talks to the same origin that serves it. This module lets
 * you point it at ANY backend (e.g. an OpenAI-compatible vllm server, or another
 * llama.cpp server) for speed testing, without the ~1.8GB open-webui.
 *
 * The endpoint is configured in **Settings → General → API endpoint** and is
 * remembered in `localStorage` under the key `llamaui.apiBase`.
 *
 * Resolution order (first source that is present wins):
 *   1. localStorage  `llamaui.apiBase`   (the Settings "API endpoint" value)
 *   2. ''            same origin          (a llama.cpp server serving this bundle)
 *
 * A trailing `/v1` in the base is tolerated: the llama.cpp endpoint paths already
 * begin with `v1/...`, so `resolveApiUrl` de-duplicates it (no `/v1/v1/...`).
 *
 * SSR-safe: on the server (no window) the getter resolves to '' (same origin).
 */
const STORAGE_KEY = 'llamaui.apiBase';

/**
 * Normalize a raw base URL: trim, add an http:// scheme if the user typed a
 * bare host[:port], validate it is http(s), and strip any trailing slash.
 * Returns '' when the input is empty or not a valid http(s) URL.
 */
export function normalizeApiBase(raw: string | null | undefined): string {
	if (!raw) return '';
	const trimmed = raw.trim();
	if (!trimmed) return '';
	let url = trimmed;
	// tolerate "192.168.32.27:8000" or "localhost:8000" without a scheme
	if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) url = 'http://' + url;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
		return parsed.toString().replace(/\/+$/, '');
	} catch {
		return '';
	}
}

/** Read the effective API base URL (localStorage -> same origin). SSR-safe. */
export function getApiBase(): string {
	if (typeof window === 'undefined') return '';

	try {
		const ls = window.localStorage.getItem(STORAGE_KEY);
		if (ls) return normalizeApiBase(ls);
	} catch {
		/* ignore storage failures */
	}

	return '';
}

/**
 * Resolve an endpoint path against the configured API base.
 * When no base is configured the path is returned unchanged, preserving the
 * original same-origin relative behavior (e.g. './v1/...' or '/v1/...').
 * When a base is configured the path is absolutized against it.
 *
 * A trailing "/v1" in the base is de-duplicated: llama.cpp endpoint paths already
 * start with "v1/...", so a base of "http://h:8000/v1" + "/v1/chat/completions"
 * resolves to "http://h:8000/v1/chat/completions" (NOT ".../v1/v1/chat/...").
 */
export function resolveApiUrl(path: string): string {
	const base = getApiBase();
	if (!base) return path;
	let p = path.replace(/^\.\//, '').replace(/^\//, '');
	if (base.endsWith('/v1') && p.startsWith('v1/')) p = p.slice(3);
	else if (base.endsWith('/v1') && p === 'v1') p = '';
	if (p === '') return base;
	return `${base}/${p}`;
}

/**
 * Persist the API base to localStorage WITHOUT reloading. The base is read from
 * localStorage at call time by getApiBase()/resolveApiUrl(), so every subsequent
 * request immediately targets the new endpoint — no page reload required. Use
 * {@link setApiBase} only when a full app reset (reload) is wanted.
 */
export function persistApiBase(url: string | null): void {
	if (typeof window === 'undefined') return;
	const norm = url ? normalizeApiBase(url) : '';

	try {
		if (norm) window.localStorage.setItem(STORAGE_KEY, norm);
		else window.localStorage.removeItem(STORAGE_KEY);
	} catch {
		/* ignore storage failures */
	}
}

/**
 * Persist the API base to localStorage and reload so the endpoint constants
 * re-bake against it. Passing null/'' clears it (falls back to same origin).
 * No query param is added to the URL — the value lives only in localStorage.
 */
export function setApiBase(url: string | null): void {
	if (typeof window === 'undefined') return;
	persistApiBase(url);
	window.location.reload();
}

/** Human-friendly display string for the field (empty when same-origin). */
export function getApiBaseDisplay(): string {
	return getApiBase();
}
