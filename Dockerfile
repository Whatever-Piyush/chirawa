# ── Stage 1: Dependencies ─────────────────────────────────────────────────────
FROM node:20-alpine AS deps

RUN corepack enable

WORKDIR /app

# Copy manifests first — Docker layer caching means
# this layer only rebuilds when package.json changes
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
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

# Generate Prisma client for production
RUN pnpm --filter @chirawa/api exec prisma generate

# ── Stage 3: Production ───────────────────────────────────────────────────────
FROM node:20-alpine AS runner

RUN corepack enable

WORKDIR /app

# Only copy what's needed to run the app
COPY --from=build /app/node_modules        ./node_modules
COPY --from=build /app/packages            ./packages
COPY --from=build /app/apps/api            ./apps/api
COPY --from=build /app/package.json        ./
COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=build /app/tsconfig.base.json  ./

# Create non-root user for security
RUN addgroup -g 1001 appgroup && \
    adduser  -u 1001 -G appgroup -s /bin/sh -D appuser && \
    chown -R appuser:appgroup /app

USER appuser

ENV NODE_ENV=production
EXPOSE 3000

# tsx handles TypeScript directly — no separate compile step needed
CMD ["node_modules/.bin/tsx", "apps/api/src/index.ts"]
