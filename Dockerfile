# syntax=docker/dockerfile:1
#
# Backend image for the Vendor Risk Portal (Express + SQLite), built to run on a
# free, ephemeral-disk host (e.g. Render). A Litestream sidecar continuously
# replicates the SQLite DB to Cloudflare R2 and restores it on boot, so data
# survives container restarts/redeploys. See docker-entrypoint.sh + litestream.yml.

# Pinned Litestream binary (multi-stage copy, per Litestream's container docs).
FROM litestream/litestream:0.3.14 AS litestream

# Compile the experiment registry (experiments/*.yml -> JSON) for the server to read at
# boot (spec 0015). Throwaway stage: only the generated JSON is copied into the final
# image, so the runtime never needs js-yaml or the experiments/ sources, and the YAML
# stays the single source of truth (no committed/derived JSON to drift).
FROM node:22-bookworm-slim AS experiments
WORKDIR /build
COPY scripts/ ./scripts/
COPY experiments/ ./experiments/
RUN npm install --no-save --no-package-lock js-yaml@^4 ajv@^8 \
  && node scripts/experiments.mjs build

FROM node:22-bookworm-slim

# CA certs for outbound HTTPS (R2, Google, Anthropic) + build tools as a fallback
# for compiling better-sqlite3 if no prebuilt binary matches this platform/ABI.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream

WORKDIR /app

# Install server deps first for better layer caching. `npm ci` installs strictly from
# the copied lockfile (reproducible + faster than `install`, never mutates the lock).
# `tsx` (which `npm start` runs) is a runtime dependency, so `--omit=dev` keeps it while
# excluding test-only devDependencies (supertest, c8, typescript, @types/*).
COPY server/package*.json ./server/
RUN npm --prefix server ci --omit=dev

# App source + Litestream config + entrypoint.
COPY server/ ./server/
# The experiment registry compiled in the `experiments` stage above (spec 0015).
COPY --from=experiments /build/server/src/data/experiments.json ./server/src/data/experiments.json
COPY litestream.yml /etc/litestream.yml
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh && mkdir -p /data

ENV NODE_ENV=production
# Render injects PORT at runtime; the app reads process.env.PORT (defaults 4100).
EXPOSE 4100

ENTRYPOINT ["/app/docker-entrypoint.sh"]
