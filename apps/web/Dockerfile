FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=640

RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml /app/
COPY apps/web/package.json /app/apps/web/package.json
COPY packages/passport-client/package.json /app/packages/passport-client/package.json
RUN pnpm install --frozen-lockfile --filter @llmweb/web... --network-concurrency=4 --child-concurrency=1

FROM base AS builder
COPY --from=deps /app /app
COPY apps/web /app/apps/web
COPY packages/passport-client /app/packages/passport-client
COPY scripts/install-runner.sh /app/scripts/install-runner.sh
RUN pnpm build:web

FROM --platform=$TARGETPLATFORM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e AS runner

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["apps/web/server.js"]
