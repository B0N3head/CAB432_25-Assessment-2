# -------- Stage 1: build client --------
FROM node:20-bookworm-slim AS clientbuild
WORKDIR /app
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci
COPY client ./client
RUN cd client && npm run build

# -------- Stage 2: server runtime --------
FROM node:20-bookworm-slim
WORKDIR /app

# Install ffmpeg for rendering
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Server deps
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# Copy server sources
COPY server ./server

# Copy built client to server/public
COPY --from=clientbuild /app/client/dist ./server/public

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000
WORKDIR /app/server
CMD ["node", "src/index.js"]
