# ----------------------------------------------------------------------------
# Cornerstone Project Tracker — production image.
# The app uses PostgreSQL via the pure-JS `pg` driver, so no native build
# toolchain is required. Set DATABASE_URL at runtime to point at your database.
# ----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS base
WORKDIR /app
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
EXPOSE 3000
# Next reads $PORT; bind all interfaces so the platform can route to it.
# Provide DATABASE_URL (Postgres connection string) via the platform's env vars.
CMD ["sh", "-c", "npm start -- -H 0.0.0.0 -p ${PORT:-3000}"]
