# syntax=docker/dockerfile:1
# Turborepo with-docker pattern: https://github.com/vercel/turborepo/tree/main/examples/with-docker

ARG BUN_VERSION=1.3.11
ARG NODE_VERSION=24-bookworm-slim

# ---------------------------------------------------------------------------
# prepare: prune the monorepo to openai-oauth and its workspace dependencies
# ---------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION} AS prepare
WORKDIR /app

COPY . .
RUN bunx turbo prune openai-oauth --docker

# ---------------------------------------------------------------------------
# builder: install pruned lockfile, then build the pruned workspace
# ---------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION} AS builder
WORKDIR /app

ENV TURBO_TELEMETRY_DISABLED=1

COPY --from=prepare /app/out/json/ .
RUN bun install --frozen-lockfile

COPY --from=prepare /app/out/full/ .
# turbo prune does not include root build helpers referenced by workspace packages
COPY --from=prepare /app/scripts/clean-dist.mjs ./scripts/clean-dist.mjs
COPY --from=prepare /app/tsconfig.base.json ./tsconfig.base.json
RUN bunx turbo run build

# ---------------------------------------------------------------------------
# runtime: Node server with optional HTTP(S) proxy for all outbound requests
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

# Build-time proxy (used by apt/npm while building this stage, if set).
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ARG http_proxy
ARG https_proxy
ARG no_proxy

# Runtime proxy knobs — override at `docker run` / compose time.
ENV NODE_ENV=production \
	NODE_USE_ENV_PROXY=1 \
	CODEX_HOME=/data/codex

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates \
	&& rm -rf /var/lib/apt/lists/* \
	&& mkdir -p /data/codex \
	&& chown -R node:node /data

# Copy only built workspace artifacts needed at runtime (not full builder tree).
COPY --from=builder --chown=node:node /app/package.json /app/bun.lock ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/packages/core/package.json ./packages/core/
COPY --from=builder --chown=node:node /app/packages/core/dist ./packages/core/dist
COPY --from=builder --chown=node:node /app/packages/local/package.json ./packages/local/
COPY --from=builder --chown=node:node /app/packages/local/dist ./packages/local/dist
COPY --from=builder --chown=node:node /app/packages/ai-sdk/package.json ./packages/ai-sdk/
COPY --from=builder --chown=node:node /app/packages/ai-sdk/dist ./packages/ai-sdk/dist
COPY --from=builder --chown=node:node /app/packages/openai-oauth/package.json ./packages/openai-oauth/
COPY --from=builder --chown=node:node /app/packages/openai-oauth/dist ./packages/openai-oauth/dist

COPY --chown=node:node docker ./docker
RUN npm install --omit=dev --prefix /app/docker undici@7 \
	&& chmod +x /app/docker/entrypoint.sh \
	&& chown -R node:node /app/docker

USER node

EXPOSE 10531

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:10531/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

VOLUME ["/data/codex"]

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["node", "packages/openai-oauth/dist/cli.js", "--host", "0.0.0.0", "--port", "10531", "--no-open"]
