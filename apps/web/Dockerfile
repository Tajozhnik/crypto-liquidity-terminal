# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# Install pnpm via npm (more reliable across proxied environments than corepack download)
RUN npm install -g pnpm@9.7.0

# ---- deps -------------------------------------------------------------------
FROM base AS deps
WORKDIR /repo
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install

# ---- build ------------------------------------------------------------------
FROM deps AS build
WORKDIR /repo
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared
RUN pnpm install
WORKDIR /repo/apps/web
RUN pnpm exec next build

# ---- runtime ----------------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
