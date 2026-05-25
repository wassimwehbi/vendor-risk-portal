# syntax=docker/dockerfile:1
#
# Backend image for the Vendor Risk Portal (Express + SQLite), built to run on a
# free, ephemeral-disk host (e.g. Render). A Litestream sidecar continuously
# replicates the SQLite DB to Cloudflare R2 and restores it on boot, so data
# survives container restarts/redeploys. See docker-entrypoint.sh + litestream.yml.

# Pinned Litestream binary (multi-stage copy, per Litestream's container docs).
FROM litestream/litestream:0.3.14 AS litestream

FROM node:22-bookworm-slim

# CA certs for outbound HTTPS (R2, Google, Anthropic) + build tools as a fallback
# for compiling better-sqlite3 if no prebuilt binary matches this platform/ABI.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream

WORKDIR /app

# Install server deps first for better layer caching. NODE_ENV is intentionally
# unset here so devDependencies — including `tsx`, which `npm start` runs — are
# installed. (Litestream/the entrypoint set NODE_ENV=production at runtime.)
COPY server/package*.json ./server/
RUN npm --prefix server install

# App source + Litestream config + entrypoint.
COPY server/ ./server/
COPY litestream.yml /etc/litestream.yml
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh && mkdir -p /data

ENV NODE_ENV=production
# Render injects PORT at runtime; the app reads process.env.PORT (defaults 4100).
EXPOSE 4100

ENTRYPOINT ["/app/docker-entrypoint.sh"]
