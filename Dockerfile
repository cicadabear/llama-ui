# llama-ui : a lightweight replacement for the bloated open-webui.
#
# Builds the (modified) llama.cpp SvelteKit web UI as a static bundle and serves
# it with a tiny dependency-free static server. The UI can be pointed at ANY
# endpoint to test token speed:
#
#   docker build -f tools/ui/Dockerfile -t llama-ui tools/ui/
#   docker run -p 8080:8080 llama-ui
#   # open:  http://<host>:8080
#   #   then set your backend in  Settings -> General -> API endpoint
#   #   (e.g. http://192.168.32.27:8000) and click "Apply & reload".
#
# The custom endpoint just needs to be reachable from the browser and to allow
# CORS (a llama.cpp server reflects the Origin header; vllm returns
# Access-Control-Allow-Origin: *). The app uses hash routing + relativized
# assets, so a plain static server is all that's required.

# ---------- Stage 1: build the modified SvelteKit web UI (static) ----------
FROM node:22-bookworm-slim AS ui
WORKDIR /ui
# install exact deps first (layer-cached); `npm ci` also runs the `prepare`
# script (svelte-kit sync)
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
# now copy the source (node_modules is not part of the build context)
COPY . ./
# build the static site -> /ui/dist  (adapter-static, default outDir)
RUN npx svelte-kit sync && npx vite build

# ---------- Stage 2: minimal runtime that serves the built UI ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV PORT=8080
COPY --from=ui /ui/dist ./public
COPY server.mjs ./server.mjs
EXPOSE 8080
CMD ["node", "server.mjs"]
