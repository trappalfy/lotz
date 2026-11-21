# Indexer image (any container host: Railway, Fly.io, Render, a VPS). Build from the repository root:
#   docker build -f apps/indexer/Dockerfile -t lotz-indexer .
FROM node:24-bookworm-slim
RUN npm install -g pnpm@12.14.0
WORKDIR /app
COPY . .
# only the indexer and the workspace packages it uses
RUN pnpm install --frozen-lockfile --filter "@lotz/indexer..."
ENV NODE_ENV=production INDEXER_HOST=0.0.0.0
EXPOSE 4100
CMD ["pnpm", "--filter", "@lotz/indexer", "start"]
