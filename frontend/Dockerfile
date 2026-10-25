# syntax=docker/dockerfile:1
#
# Practical 11 — Task Management frontend (React 19 + Vite 8)
# Multi-stage: build the production bundle, then serve it with Vite's preview
# server (the project is Vite-based, so this matches the existing toolchain).
#
# Host `node_modules`, `dist/` and `.env` (which holds a real GitHub token)
# are never part of the build context.

# ---------- stage 1: build ----------
FROM node:24-slim AS build

WORKDIR /app

# Same Node major the project uses (24.12) and satisfies vite's engines
# (^20.19 || >=22.12).
ENV CI=true

# Manifests first => dependency layer is cached across source changes.
COPY package.json package-lock.json ./

RUN npm ci

# Source needed by `vite build` only.
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src

# Backend URL baked into the bundle. The browser (not this container) calls the
# API, so the default is the host-published backend port. Override per
# deployment without touching source, e.g.:
#   docker compose build --build-arg VITE_API_URL=https://api.example.com
ARG VITE_API_URL=http://localhost:5000
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

# ---------- stage 2: runtime ----------
FROM node:24-slim AS runtime

ENV NODE_ENV=production
ENV CI=true

# The container runs as the unprivileged "node" user, so /app (created by
# WORKDIR as root) and everything placed in it must belong to that user —
# otherwise Vite cannot create its temp files under node_modules/.vite-temp
# and preview dies with EACCES. The ownership change rides on the COPY layers
# (--chown), so it costs no extra image layers.
RUN mkdir -p /app && chown node:node /app
WORKDIR /app

# package.json (for `npm run preview`), the installed dependency tree and the
# built bundle all come from the build stage — nothing from the host.
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/vite.config.js ./vite.config.js
COPY --chown=node:node --from=build /app/index.html ./index.html
COPY --chown=node:node --from=build /app/dist ./dist

# vite preview's container port (host 5173 maps to it in docker-compose.yml).
EXPOSE 5173

USER node

# --host 0.0.0.0   : required — otherwise preview binds 127.0.0.1 and the host
#                    browser could never reach the container.
# --port 5173      : explicit, so the Compose port mapping is always truthful.
# --strictPort     : fail loudly instead of silently moving to another port.
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]
