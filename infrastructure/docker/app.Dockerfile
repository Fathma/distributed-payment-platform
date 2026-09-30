FROM node:22-alpine AS build

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime

WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps ./apps
COPY --from=build /workspace/packages ./packages
COPY --from=build /workspace/dist ./dist

ARG SERVICE
ENV SERVICE=${SERVICE}
CMD ["sh", "-c", "node dist/apps/$SERVICE/main.js"]
