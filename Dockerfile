FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS dependencies
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run generate -w @okr/api && npm run build

FROM build AS api
ENV NODE_ENV=production
ENV NODE_OPTIONS=--enable-source-maps
USER node
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@okr/api"]

FROM nginx:1.28-alpine AS web
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80

FROM build AS tools
CMD ["npm", "test"]

FROM mcr.microsoft.com/playwright:v1.56.1-noble AS browser-tests
WORKDIR /app
COPY --from=build /app /app
CMD ["npm", "run", "test:e2e"]

# ok, any tools to create an admin account? I do not have any