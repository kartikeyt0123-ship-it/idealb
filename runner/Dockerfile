# Isolated code runner: Node 22 + CPython 3, non-root, no compilers, no network (compose puts it on an internal network).
FROM node:22-bookworm-slim AS build
WORKDIR /runner
COPY runner/package.json ./
RUN npm install --no-save typescript@5 @types/node@22
COPY runner/tsconfig.json ./
COPY runner/src src
RUN npx tsc -p tsconfig.json

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-numpy python3-pandas python3-matplotlib && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin runner
WORKDIR /runner
COPY --from=build /runner/dist dist
USER runner
ENV RUNNER_HOST=0.0.0.0 RUNNER_PORT=4100 RUNNER_PYTHON_BIN=python3 RUNNER_PYTHON_USER_SITE=false TMPDIR=/tmp
EXPOSE 4100
CMD ["node", "dist/server.js"]
