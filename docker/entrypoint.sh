#!/bin/sh
set -eu

ROLE="${APP_ROLE:-web}"

if [ "${RUN_MIGRATIONS_ON_BOOT:-false}" = "true" ]; then
  echo "[entrypoint] Running prisma migrate deploy..."
  npm run prisma:migrate:deploy
fi

if [ "${RUN_SEED_ON_BOOT:-false}" = "true" ]; then
  echo "[entrypoint] Running prisma seed..."
  npm run prisma:seed
fi

if [ "$ROLE" = "worker" ]; then
  echo "[entrypoint] Starting background worker..."
  exec npm run worker:start
fi

echo "[entrypoint] Starting web server..."
exec npm run start
