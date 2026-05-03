# ── Stage 1: Build React app ─────────────────────────────────────────────────
FROM node:20-alpine AS app-build
WORKDIR /build/app
COPY app/package.json ./
RUN npm install
COPY app/ ./
RUN npm run build

# ── Stage 2: Build Express server ────────────────────────────────────────────
FROM node:20-alpine AS server-build
WORKDIR /build/server
COPY server/package.json ./
RUN npm install
COPY server/ ./
RUN npm run build

# ── Stage 3: Production image ─────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Copy server production deps
COPY server/package.json ./
RUN npm install --omit=dev

# Copy compiled server
COPY --from=server-build /build/server/dist ./dist

# Copy React build into the location the server expects
COPY --from=app-build /build/app/dist ./app/dist

# Data directory (Railway ephemeral FS)
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

EXPOSE 3000

CMD ["node", "dist/index.js"]
