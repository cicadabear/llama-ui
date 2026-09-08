// Tiny, dependency-free static file server for the built llama-ui bundle.
//
// Serves the SvelteKit static output (index.html + assets) with an SPA fallback
// for route paths and correct MIME types.
//
// The UI has no model of its own; it talks to a model endpoint that the user
// configures in **Settings → General → API endpoint** (remembered in the
// browser's localStorage) and calls directly. With no endpoint configured the
// UI uses the same origin (a llama.cpp server that also serves this bundle).
//
// API-looking paths (v1/*, props, slots, tools, stream, ...) are answered with a
// clean JSON 404 rather than index.html, so a not-yet-configured endpoint shows
// a clear error instead of "Unexpected token '<' ... is not valid JSON".
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';

const PORT = Number(process.env.PORT || 8080);
const ROOT = normalize(process.env.UI_DIR || './public');

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.txt': 'text/plain; charset=utf-8'
};

// API-looking paths the static server must never answer with index.html. The UI
// calls these on the configured API base; if that base is unset (same origin)
// they would otherwise hit us and receive HTML, which the browser surfaces as
// "Unexpected token '<' ... is not valid JSON". A clean 404 is far clearer.
const API_PATH = /^\/(v1\/|props$|props\/|slots$|slots\/|tools$|tools\/|stream\/|api\/|cors-proxy)/;

async function resolve(pathname) {
	const filePath = normalize(join(ROOT, decodeURIComponent(pathname)));
	if (!filePath.startsWith(ROOT)) return { status: 403, type: 'text/plain', body: 'forbidden' };

	try {
		const st = await stat(filePath);
		if (st.isDirectory()) return { file: join(filePath, 'index.html') };
		return { file: filePath };
	} catch {
		// not a real file on disk:
		if (API_PATH.test(pathname)) {
			return {
				status: 404,
				type: 'application/json',
				body: JSON.stringify({ error: 'no such endpoint on the static llama-ui server — set an API endpoint in Settings → General' })
			};
		}
		return { file: join(ROOT, 'index.html') }; // SPA route -> index.html
	}
}

createServer(async (req, res) => {
	try {
		let pathname = '/';
		try {
			pathname = new URL(req.url, 'http://localhost').pathname;
		} catch {
			/* keep default */
		}
		if (pathname === '/') pathname = '/index.html';

		const r = await resolve(pathname);
		if (r.status) {
			res.writeHead(r.status, { 'Content-Type': r.type });
			return res.end(r.body);
		}

		const buf = await readFile(r.file);
		res.writeHead(200, { 'Content-Type': MIME[extname(r.file)] || 'application/octet-stream' });
		res.end(buf);
	} catch (err) {
		res.writeHead(500, { 'Content-Type': 'text/plain' });
		res.end('server error');
	}
}).listen(PORT, '0.0.0.0', () => {
	console.log(
		`\n  llama-ui (custom-API) serving "${ROOT}" on http://0.0.0.0:${PORT}\n` +
			`  set the model endpoint in  Settings → General → API endpoint\n` +
			`  (e.g. http://192.168.32.27:8000) — or leave empty for same origin\n`
	);
});
