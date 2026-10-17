# syntax=docker/dockerfile:1.7
#
# EventCatalog for the warehouse-systems ecosystem, fleet-standard packaging:
# multi-stage (node build -> nginx-unprivileged runtime, uid 101, port 8080),
# digest-pinned bases, static output served read-only.
#
# The build regenerates the catalog inside the image: `npm run build` runs the
# generator pipeline (prepare-specs -> asyncapi/openapi generators -> Astro SSG)
# from the committed specs/ + domains/, so the image never depends on build
# artifacts from the CI runner. license.jwt is NEVER in the image (git-ignored,
# docker-ignored); the catalog builds fine without it.

# --- build stage ---
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY . .
# Astro in Docker needs more than the default heap (same fix as the scaffold).
ENV NODE_OPTIONS=--max_old_space_size=2048
RUN npm run build && printf 'ok' > dist/healthz

# --- runtime stage ---
# 1.31-alpine digest shared with warehouse-console so both UI images track the
# same CVE-patched base; apk upgrade matches the fleet's Go-service runtime stages.
FROM nginxinc/nginx-unprivileged:1.31-alpine@sha256:378d0c32f6562f7fd9629170797f57d2b953aa09be983b3daaf4809bb039ca00
USER root
RUN apk upgrade --no-cache
USER nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html
EXPOSE 8080
