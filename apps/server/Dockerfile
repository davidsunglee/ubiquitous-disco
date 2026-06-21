# ── Approach: Node install stage → oven/bun runtime ──────────────────────────
#
# This repo uses pnpm workspaces with pnpm-lock.yaml only (no bun.lock).
# pnpm 11.x requires node:sqlite which is available in Node 22+ but not in
# Bun 1.3.x, so we use a Node image for the install stage and hand the built
# node_modules tree to a lean oven/bun runtime image.
#
# Build stages:
#   install — Node 22 + pnpm 11: install all workspace deps (frozen lockfile)
#   release — oven/bun runtime: minimal image, USER bun, no dev files
#
# Build from the repository root:
#   docker build -f apps/server/Dockerfile -t bb-server .

# ── install: Node 22 + pnpm, frozen lockfile ──────────────────────────────────
FROM node:22-alpine AS install
WORKDIR /app

# Enable pnpm via corepack (ships with Node 22).
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate

# Copy workspace manifests so pnpm can resolve the workspace graph.
# All package.json files must be present before `pnpm install` runs.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/sim/package.json packages/sim/
COPY packages/protocol/package.json packages/protocol/
COPY tsconfig.base.json ./

RUN pnpm install --frozen-lockfile --ignore-scripts

# ── release: oven/bun runtime, minimal image ──────────────────────────────────
FROM oven/bun:1-alpine AS release
WORKDIR /app

# Copy installed node_modules from the install stage.
# pnpm workspaces install deps at multiple levels:
#   - root node_modules: devDependencies shared across the workspace
#   - apps/server/node_modules: @bb/* workspace symlinks + direct deps
#   - packages/sim/node_modules: @dimforge/rapier2d-deterministic-compat (WASM)
#   - packages/protocol/node_modules: protocol-specific deps (if any)
COPY --from=install /app/node_modules ./node_modules
COPY --from=install /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=install /app/packages/sim/node_modules ./packages/sim/node_modules
COPY --from=install /app/packages/protocol/node_modules ./packages/protocol/node_modules

# Copy source files needed at runtime (TypeScript run directly by bun).
COPY apps/server/src ./apps/server/src
COPY apps/server/scripts ./apps/server/scripts
COPY apps/server/package.json ./apps/server/
COPY packages/sim/src ./packages/sim/src
COPY packages/sim/package.json ./packages/sim/
COPY packages/protocol/src ./packages/protocol/src
COPY packages/protocol/package.json ./packages/protocol/
COPY tsconfig.base.json ./

EXPOSE 2567

# Liveness health check: fetches /healthz/live and exits 0 on HTTP 200.
# --start-period gives the server time to initialise Rapier WASM before checks begin.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD bun run apps/server/scripts/healthcheck.ts || exit 1

USER bun

ENTRYPOINT ["bun", "run", "apps/server/src/index.ts"]
