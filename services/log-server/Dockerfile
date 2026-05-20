FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile || bun install --production

COPY src ./src

ENV PORT=3030
ENV LOG_DIR=/app/logs

EXPOSE 3030

VOLUME ["/app/logs"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://localhost:${PORT}/health" || exit 1

CMD ["bun", "run", "src/server.js"]
