FROM oven/bun:1.2.18 AS builder

WORKDIR /app

COPY package.json bun.lock tsconfig.base.json turbo.json biome.json ./
COPY packages ./packages

RUN bun install
WORKDIR /app/packages/openai-oauth
RUN bun run build

FROM node:22-slim AS runtime

ENV NODE_ENV=production
ENV HOME=/home/node
ENV CODEX_HOME=/home/node/.codex

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

RUN mkdir -p /home/node/.codex && chown -R node:node /home/node/.codex
USER node

EXPOSE 10531

ENTRYPOINT ["node", "/app/packages/openai-oauth/dist/cli.js"]
CMD ["--host", "0.0.0.0", "--port", "10531", "--oauth-file", "/home/node/.codex/auth.json"]
