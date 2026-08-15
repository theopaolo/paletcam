FROM oven/bun:1.3.11-alpine@sha256:7ed9f74c326d1c260abe247ac423ccbf5ac92af62bb442d515d1f92f21e8ea9b

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile

COPY src ./src

# The named-volume mount inherits this directory's ownership on first use.
# Bind mounts must provide equivalent write access for uid/gid 1000.
RUN mkdir -p /app/data && chown bun:bun /app/data

ENV PORT=3040
ENV DATA_DIR=/app/data
ENV NODE_ENV=production

EXPOSE 3040

VOLUME ["/app/data"]

USER bun

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://localhost:${PORT}/health" || exit 1

CMD ["bun", "run", "src/server.js"]
