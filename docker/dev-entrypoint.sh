#!/bin/sh
set -e

# docker-compose.yml already gates this container on mongo's healthcheck, so the
# replica set has a primary by the time we get here.

if [ "$SEED_ON_BOOT" = "true" ]; then
  # The seed is idempotent: it detects an already-populated database and skips,
  # so restarting the stack does not wipe work in progress. Set FORCE_RESEED=true
  # to override.
  echo "==> Seeding database (import runs over the provided CSVs)"
  npm run seed
fi

echo "==> Starting Next.js dev server on http://localhost:3000"
exec npm run dev
