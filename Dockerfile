# API + worker image (also serves the built web app). Build from the repo root:
#   docker build -t among-bugs .
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY runner/package.json runner/
COPY web/package.json web/
RUN npm ci --ignore-scripts
COPY server server
COPY web web
RUN npm run build -w server && npm run build -w web

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY runner/package.json runner/
COPY web/package.json web/
RUN npm ci --omit=dev --ignore-scripts -w server && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
RUN useradd --uid 10002 --create-home appuser
USER appuser
ENV WEB_DIST_DIR=/app/web/dist HOST=0.0.0.0 PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
