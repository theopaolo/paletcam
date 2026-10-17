FROM oven/bun:1.4.3-alpine@sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile

COPY src ./src

# The named-volume mount inherits this directory's ownership on first use.
# Bind mounts must provide equivalent write access for uid/gid 1000.
RUN mkdir -p /app/logs && chown bun:bun /app/logs

ENV PORT=3030
ENV LOG_DIR=/app/logs
ENV NODE_ENV=production

EXPOSE 3030

VOLUME ["/app/logs"]

USER bun

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://localhost:${PORT}/health" || exit 1

CMD ["bun", "run", "src/server.js"]
