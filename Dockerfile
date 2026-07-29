# syntax=docker/dockerfile:1

# ---- base -------------------------------------------------------------------
FROM node:24-alpine AS base
WORKDIR /app
# libc6-compat: Next's SWC binary is glibc-linked; Alpine needs the shim.
RUN apk add --no-cache libc6-compat

# ---- deps -------------------------------------------------------------------
FROM base AS deps
# .npmrc matters here: it carries the peer-dependency resolution that makes the
# lockfile installable with `npm ci`. Without it the build fails on a conflict
# inside optional wasm fallback binaries that are never actually loaded.
COPY package.json package-lock.json* .npmrc ./
RUN npm ci

# ---- dev --------------------------------------------------------------------
# Used by `docker compose up`. Source is bind-mounted over /app, so this stage
# only needs the installed node_modules (kept out of the mount by an anonymous
# volume in docker-compose.yml).
FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["sh", "./docker/dev-entrypoint.sh"]

# ---- build ------------------------------------------------------------------
FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- prod -------------------------------------------------------------------
# Not used for the Vercel deployment, but keeps `docker compose` and a container
# host (Fly/Railway) as a working fallback.
FROM base AS prod
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
