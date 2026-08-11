FROM node:22-alpine
WORKDIR /app
COPY packages/admin-web ./packages/admin-web
ENV PORT=4102
EXPOSE 4102
CMD ["node", "packages/admin-web/server.mjs"]
