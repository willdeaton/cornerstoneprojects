# ----------------------------------------------------------------------------
# Cornerstone Project Tracker — production image.
# Uses a full toolchain so the native better-sqlite3 module compiles reliably
# (this is what typically fails on a default Nixpacks build).
# ----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS base
WORKDIR /app
# Build tools needed by node-gyp / better-sqlite3
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1

# ---- install dependencies (incl. dev deps, needed to build) ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- build the Next.js app ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runtime image ----
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs
# Data dir for the SQLite database (mount a persistent volume here in prod).
RUN mkdir -p /app/data/uploads
EXPOSE 3000
# Next reads $PORT; bind all interfaces so the platform can route to it.
CMD ["sh", "-c", "npm start -- -H 0.0.0.0 -p ${PORT:-3000}"]
