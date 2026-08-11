FROM node:22-alpine
WORKDIR /app
COPY packages/admin-agent/package.json ./package.json
COPY packages/admin-agent/server.mjs ./server.mjs
EXPOSE 4103
CMD ["node", "server.mjs"]
