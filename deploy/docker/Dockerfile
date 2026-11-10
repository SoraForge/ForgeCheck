# Standalone image for ForgeCheck Issue #37. Build with repository root as context.
# Pin the Node patch line and npm dependency graph; for byte-for-byte base
# immutability, set NODE_IMAGE to a verified node@sha256 digest at build time.
ARG NODE_IMAGE=node:22.16.0-bookworm-slim

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY scripts/clean-build.mjs ./scripts/clean-build.mjs
COPY src/ ./src/
COPY deploy/docker/ ./deploy/docker/
# Run the isolated feature's positive/negative contract tests during image build.
RUN npm run build \
    && node --test deploy/docker/contract.test.mjs \
    && find dist -type f \( -name '*.d.ts' -o -name '*.d.ts.map' -o -name '*.js.map' \) -delete \
    && mkdir -p /runtime/src/modules \
    && cp -R src/modules/. /runtime/src/modules/ \
    && find /runtime/src/modules -type f ! -name '*.mjs' -delete

FROM ${NODE_IMAGE} AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production HOME=/tmp
WORKDIR /opt/forgecheck
COPY --from=builder /app/dist/ ./dist/
# The built application imports existing .mjs modules relative to dist/application.js.
COPY --from=builder /runtime/src/modules/ ./src/modules/
COPY --from=production-dependencies /app/node_modules/ ./node_modules/
COPY package.json LICENSE ./
USER node:node
ENTRYPOINT ["node", "/opt/forgecheck/dist/cli.js"]
CMD ["--help"]
