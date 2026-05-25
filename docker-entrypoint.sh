#!/bin/sh
set -e

DB_PATH="${VRP_DB_PATH:-/data/vendor-risk.db}"

# Render's free disk is ephemeral: a fresh container starts with no DB. Restore
# the latest snapshot from R2 if there's no local DB yet. No-op on the very first
# deploy (no replica exists yet) thanks to -if-replica-exists.
litestream restore -if-db-not-exists -if-replica-exists "$DB_PATH"

# Run the app under Litestream so the SQLite WAL is continuously replicated to R2.
# On SIGTERM (deploy/restart) Litestream flushes a final sync before exiting, so
# graceful restarts lose ~nothing. Config is read from /etc/litestream.yml.
exec litestream replicate -exec "npm --prefix server start"
