# syntax=docker/dockerfile:1
#
# Practical 11 — Task Management backend
# Node.js 24 (Express + Mongoose, ES modules, no build step).
#
# Node 24 matches the runtime this project is developed against (Node 24.12)
# and satisfies every dependency's engines range (vite ^20.19 || >=22.12,
# mongoose >=20.19). The -slim Debian variant keeps glibc, so there are no
# musl/native-binary surprises.
#
# No .env, no secrets, no node_modules and no Git history are ever copied into
# this image: every runtime setting is injected by docker-compose.yml.

FROM node:24-slim

WORKDIR /app

# Default for the image; docker-compose.yml passes backend/.env through
# env_file, and any value there (currently NODE_ENV=development) wins over it,
# so local development behaviour is unchanged.
ENV NODE_ENV=production

# 1) Package manifests FIRST so this expensive layer is cached until
#    package.json / package-lock.json actually change.
COPY package.json package-lock.json ./

# 2) Reproducible install straight from the lockfile, production deps only
#    (nodemon is a devDependency and is not needed to run the server).
RUN npm ci --omit=dev

# 3) Application source last — the smallest set that can start the server:
#    server.js + src/. Tests, ad-hoc scripts, Postman collections and .env
#    stay out of the image.
COPY server.js ./
COPY src ./src

# config.port (PORT || 5000). Node's server.listen(port) without a host
# binds all interfaces, so the API is reachable as "backend:5000" on the
# Compose network and as host port 5000 from the browser.
EXPOSE 5000

# Drop root: the app only ever reads files, so the unprivileged "node" user
# from the official image is sufficient.
USER node

# Existing start command (package.json "start": "node server.js").
CMD ["node", "server.js"]
