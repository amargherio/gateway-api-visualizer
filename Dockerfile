FROM docker.io/library/node:24-bookworm-slim AS dependencies
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches

FROM dependencies AS source
RUN pnpm install --frozen-lockfile
COPY . .

FROM source AS build
RUN pnpm run build

FROM source AS api-build
RUN pnpm exec tsc --project tsconfig.json --outDir api-dist --declaration false --sourceMap false

FROM dependencies AS production-dependencies
RUN pnpm install --prod --frozen-lockfile

FROM docker.io/library/node:24-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY package.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=api-build /app/api-dist/server ./server
COPY --from=api-build /app/api-dist/src/lib ./src/lib
COPY --from=api-build /app/api-dist/data ./data
COPY public/gateway-api ./public/gateway-api
USER node
EXPOSE 3001
CMD ["node", "server/index.js"]

FROM docker.io/nginxinc/nginx-unprivileged:stable-alpine AS web
COPY containers/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html/gateway-api-visualizer
EXPOSE 8080
