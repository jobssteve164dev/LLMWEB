FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml /app/
COPY apps/web/package.json /app/apps/web/package.json
COPY packages/passport-client/package.json /app/packages/passport-client/package.json
RUN pnpm install --frozen-lockfile
COPY apps/web /app/apps/web
COPY packages/passport-client /app/packages/passport-client
RUN pnpm build:web

CMD ["pnpm", "--filter", "@llmweb/web", "start"]
