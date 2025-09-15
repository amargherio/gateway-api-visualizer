# Simple production image for server
FROM node:20-alpine AS build
WORKDIR /app
COPY ../../package.json ../../pnpm-workspace.yaml ./
COPY ../../packages ./packages
RUN corepack enable && pnpm install --filter @gav/server... --prod=false && pnpm --filter @gav/server build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/packages/server/dist ./dist
COPY --from=build /app/packages/server/package.json ./package.json
RUN corepack enable && pnpm install --prod --ignore-scripts
EXPOSE 4000
CMD ["node", "dist/index.js"]
