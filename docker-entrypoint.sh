#!/bin/sh
# Applies pending database migrations, then starts the server.
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set" >&2
  exit 1
fi
if [ -z "${SESSION_SECRET:-}" ] || [ "${#SESSION_SECRET}" -lt 32 ]; then
  echo "SESSION_SECRET must be set to at least 32 characters" >&2
  exit 1
fi

echo "Applying database migrations..."
node /app/prisma-cli/node_modules/prisma/build/index.js migrate deploy --config /app/prisma.config.ts

echo "Starting Darkpools on port ${PORT:-3000}..."
exec "$@"
