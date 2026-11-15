# Twilio bridge container for Fargate. Build from the repo root:
#   docker build -f backend/twilio/Dockerfile .
# The bridge is bundled into one file with esbuild, so the runtime image has no node_modules.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace backend --include-workspace-root --ignore-scripts --no-audit --no-fund
COPY contracts contracts
COPY backend backend
# ESM bundle; the banner gives bundled CommonJS packages (twilio) a working require().
# The output sits in backend/twilio/ so `new URL('../cdk.json', import.meta.url)` still finds backend/cdk.json.
RUN npx esbuild backend/twilio/server.ts --bundle --platform=node --format=esm --target=node22 \
      --outfile=backend/twilio/server.mjs \
      --banner:js="import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"

FROM node:22-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app/backend
COPY --from=build /app/backend/twilio/server.mjs twilio/server.mjs
COPY backend/cdk.json cdk.json
USER node
EXPOSE 8080
CMD ["node", "twilio/server.mjs"]
