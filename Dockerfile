# syntax=docker/dockerfile:1

# ---- Stage 1: build the client bundle (Vite -> dist/client, assets baked in) ----
FROM node:22-alpine AS builder
WORKDIR /app

# Install all deps (dev included) for the Vite build.
COPY package.json package-lock.json ./
RUN npm ci

# Build the production client. Vite copies assets/ into dist/client via publicDir.
COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY assets ./assets
RUN npm run build:client

# ---- Stage 2: lean runtime that serves client + Colyseus on one port ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Runtime deps only (express + colyseus); tsx runs the TS server entrypoint.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install -g tsx@4 && npm cache clean --force

# Server reads source at runtime via tsx; client was built in the builder stage.
# tsconfig.json is required at runtime so tsx/esbuild honors experimentalDecorators.
# Colyseus's @type is a legacy decorator; without this esbuild emits TC39-standard
# decorators and the schema crashes ("Cannot read properties of undefined
# (reading 'constructor')") on startup.
COPY tsconfig.json ./
COPY src ./src
COPY --from=builder /app/dist/client ./dist/client

# The single server process serves the static client AND the WebSocket on PORT.
# Clients connect to whatever origin served the page (location.host), so no
# hostname needs baking in — just point your domain/proxy at this port.
ENV PORT=2567
EXPOSE 2567

# Run as the non-root user that the node image ships with.
USER node

CMD ["tsx", "src/server/index.ts"]
