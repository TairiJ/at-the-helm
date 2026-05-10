# ═══════════════════════════════════
#  AT THE HELM — Dockerfile
#  Single-image AI Operator Cockpit
# ═══════════════════════════════════

# --- Stage 1: Build Client ---
FROM node:22-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# --- Stage 2: Build Server ---
FROM node:22-alpine AS server-builder
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npx tsc

# --- Stage 3: Runtime ---
FROM node:22-alpine AS runner

# dumb-init handles signals properly (clean Docker shutdown)
RUN apk add --no-cache dumb-init

WORKDIR /app

# Install production server deps only
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Copy built client
COPY --from=client-builder /app/client/dist ./client/dist

# Copy built server
COPY --from=server-builder /app/server/dist ./server/dist

# Create persistent data directory (mount a volume here in production)
RUN mkdir -p /app/data/uploads

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Health check — used by Docker, load balancers, and Kubernetes probes
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost:3000/api/health || exit 1

# Run as non-root for security
RUN addgroup -g 1001 -S helm && adduser -S helm -u 1001
RUN chown -R helm:helm /app
USER helm

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server/dist/index.js"]
