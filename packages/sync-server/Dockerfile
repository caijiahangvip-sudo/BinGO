FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/sync-server/package.json packages/sync-server/package.json
RUN pnpm install --filter @bingo/sync-server... --frozen-lockfile --ignore-scripts
COPY packages/sync-server packages/sync-server
RUN pnpm --filter @bingo/sync-server build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/sync-server/node_modules ./packages/sync-server/node_modules
COPY --from=build /app/packages/sync-server/dist ./packages/sync-server/dist
COPY --from=build /app/packages/sync-server/migrations ./packages/sync-server/migrations
COPY --from=build /app/packages/sync-server/package.json ./packages/sync-server/package.json
CMD ["node", "packages/sync-server/dist/index.js"]
