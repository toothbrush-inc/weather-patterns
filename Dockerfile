# weather-patterns — one image: the Next.js dashboard *and* the in-process
# collector (lib/scheduler.mjs), so a single container gathers history on a
# schedule with no external cron.
#
# Deliberately NOT using Next's `output: 'standalone'`: the instrumentation hook
# that starts the scheduler is unreliable in standalone mode, and plain
# `next start` runs it reliably. The image is a bit larger; for this app that's a
# fine trade — the collection path is the whole point.

FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- deps ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- run ----
FROM base AS run
ENV NODE_ENV=production
# Collect every 30 min by default (set to 0 to disable the built-in scheduler).
# All persistent data goes to /data — mount a volume there so history, settings,
# and forecasts survive restarts and image rebuilds.
ENV COLLECT_INTERVAL_MINUTES=30 \
    WEATHER_DB=/data/history.json \
    WEATHER_SETTINGS=/data/settings.json \
    WEATHER_FORECASTS=/data/forecasts.json \
    WEATHER_GAPS=/data/gaps.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs
# lib/ + scripts/ kept at runtime: the scheduler dynamic-imports lib/*.mjs, and
# `docker exec ... npm run collect` stays available for a manual one-off.
COPY --from=build /app/lib ./lib
COPY --from=build /app/scripts ./scripts
RUN mkdir -p /data
EXPOSE 3002
# next start binds 0.0.0.0 and honors $PORT (PaaS injects it; defaults to 3002).
CMD ["npm", "run", "start"]
