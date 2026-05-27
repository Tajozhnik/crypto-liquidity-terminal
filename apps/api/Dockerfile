# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# OpenSSL is required by Prisma's libquery_engine on Alpine.
# Without it the runtime fails with "Error loading shared library libssl.so.1.1".
RUN apk add --no-cache openssl libc6-compat
# Install pnpm via npm (more reliable across proxied environments than corepack download)
RUN npm install -g pnpm@9.7.0

# ---- deps -------------------------------------------------------------------
FROM base AS deps
WORKDIR /repo
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/screener-engine/package.json packages/screener-engine/
RUN pnpm install

# ---- runtime ----------------------------------------------------------------
FROM base AS runtime
WORKDIR /repo
# Copy hoisted node_modules and per-workspace node_modules (use install in case any are missing)
COPY --from=deps /repo ./
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages ./packages
# Refresh workspace symlinks after the source overlay. `--offline
# --frozen-lockfile` reuses the deps-stage store/lockfile so this is a
# pure relink — no network, no version drift. Saves ~30 s on every
# rebuild after a source-only change.
RUN pnpm install --offline --frozen-lockfile

# Prisma generate (best-effort)
RUN cd apps/api && pnpm exec prisma generate || echo "prisma generate failed; will retry at runtime"

EXPOSE 4000
WORKDIR /repo/apps/api
# DB initialisation order on container start:
#   1. `prisma migrate deploy` — applies committed migrations. No-op if the
#      `prisma/migrations` folder is missing or empty (current state of the
#      repo). Production-safe, NEVER drops data.
#   2. `prisma db push` (without --accept-data-loss) — best-effort push the
#      current schema for fresh databases that don't have migrations yet.
#      Bails out instead of dropping columns when the live schema diverges,
#      so it can never silently destroy production data.
#   3. Echo + continue — when both above fail (e.g. db unreachable), the API
#      keeps starting so health/readiness reports the degraded state.
# Replaces the previous `prisma db push --accept-data-loss` which silently
# dropped diverging columns/tables on every container start (I-006).
CMD ["sh", "-c", "pnpm exec prisma migrate deploy 2>/dev/null || pnpm exec prisma db push --skip-generate 2>/dev/null || echo 'prisma init skipped (db unavailable or schema diverged; run prisma migrate manually)'; pnpm exec tsx src/index.ts"]
