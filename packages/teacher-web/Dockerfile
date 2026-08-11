FROM node:22-alpine
WORKDIR /app
COPY packages/teacher-web ./packages/teacher-web
ENV PORT=4104
ENV BINGO_SYNC_UPSTREAM=http://sync:4100
EXPOSE 4104
CMD ["node", "packages/teacher-web/server.mjs"]
