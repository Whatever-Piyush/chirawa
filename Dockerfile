# Chirawa API image — CONTINGENCY / migration artifact, not the active deploy
# path. Production runs PM2 + compiled dist/ from a git checkout on the Hetzner
# box (see docs/DEPLOYMENT.md and docs/adr/004-deploy-pipeline.md). CI builds
# this image on every PR so it stays deployable; nothing pushes or runs it yet.

# ── Stage 1: Dependencies ─────────────────────────────────────────────────────
FROM node:20-alpine AS deps

# openssl must be present when `prisma generate` runs, or engine platform
# detection falls back to openssl-1.1.x and the runner (openssl 3) can't load it
RUN apk add --no-cache openssl && corepack enable

WORKDIR /app

# Copy manifests first — Docker layer caching means
# this layer only rebuilds when package.json changes
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json pnpm.yaml tsconfig.base.json ./
COPY packages/types/package.json        packages/types/
COPY packages/api-client/package.json   packages/api-client/
COPY apps/api/package.json              apps/api/

# Add root pnpm config to allow builds
COPY .npmrc* ./

RUN pnpm install --frozen-lockfile

# ── Stage 2: Build ────────────────────────────────────────────────────────────
FROM deps AS build

COPY packages/ packages/
COPY apps/api/  apps/api/

# Compile TypeScript → apps/api/dist (tsconfig.build.json: no tests in emit).
# Needs a generated Prisma client for typechecking.
RUN pnpm --filter @chirawa/api exec prisma generate && \
    pnpm --filter @chirawa/api build

# Drop devDependencies (typescript, tsx, vitest, …): wipe node_modules and
# re-install the production graph only, from the store cache of the earlier
# install (pnpm prune is a no-op for dev deps in workspaces, and a --prod
# install on top of an existing tree leaves orphans behind — both verified).
# Then regenerate the Prisma client into the pruned tree; the prisma CLI is a
# production dependency precisely so the image can generate and, in a
# contingency, `prisma migrate deploy`.
RUN rm -rf node_modules apps/api/node_modules packages/types/node_modules packages/api-client/node_modules && \
    pnpm install --frozen-lockfile --prod --prefer-offline && \
    pnpm --filter @chirawa/api exec prisma generate

# ── Stage 3: Production ───────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Prisma's musl engine wants openssl at runtime
RUN apk add --no-cache openssl

WORKDIR /app

# Non-root user FIRST so COPY --chown doesn't need a layer-doubling `chown -R`
RUN addgroup -g 1001 appgroup && \
    adduser  -u 1001 -G appgroup -s /bin/sh -D appuser

# Only what the compiled app needs at runtime:
#   node_modules  — pruned to production deps (symlinks into .pnpm intact)
#   packages/     — workspace symlink targets (@chirawa/types et al., source-only)
#   apps/api      — dist/ + its node_modules symlinks + prisma schema/migrations
COPY --from=build --chown=1001:1001 /app/node_modules             ./node_modules
COPY --from=build --chown=1001:1001 /app/packages                 ./packages
COPY --from=build --chown=1001:1001 /app/apps/api/node_modules    ./apps/api/node_modules
COPY --from=build --chown=1001:1001 /app/apps/api/dist            ./apps/api/dist
COPY --from=build --chown=1001:1001 /app/apps/api/prisma          ./apps/api/prisma
COPY --from=build --chown=1001:1001 /app/apps/api/package.json    ./apps/api/
COPY --from=build --chown=1001:1001 /app/package.json /app/pnpm-workspace.yaml ./

USER appuser

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "--enable-source-maps", "apps/api/dist/index.js"]
