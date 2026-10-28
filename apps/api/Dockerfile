FROM node:24-alpine AS build
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/api apps/api
RUN npm run build -w @worth-split/api

FROM node:24-alpine AS runtime
WORKDIR /workspace
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace @worth-split/api && npm cache clean --force
COPY --from=build /workspace/apps/api/dist apps/api/dist
COPY --from=build /workspace/apps/api/src/db/migrations apps/api/dist/db/migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"]
CMD ["node", "apps/api/dist/server.js"]
