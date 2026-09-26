FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @kingu-cloud/api...
COPY apps/api apps/api
RUN pnpm --filter @kingu-cloud/api build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
RUN pnpm install --prod --frozen-lockfile --filter @kingu-cloud/api...
USER node
EXPOSE 8080
CMD ["node", "apps/api/dist/index.js"]
