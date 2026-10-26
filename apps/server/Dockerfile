# Kimo relay image. Build from the repository root:
#   docker build -f apps/server/Dockerfile -t kimo-relay .
#   docker run -p 8787:8787 -v kimo-relay-data:/data kimo-relay
FROM oven/bun:1.4.4-alpine

WORKDIR /app
COPY . .
# Only the relay and the protocol core it imports are installed; the web and desktop apps are not.
RUN bun install --production --frozen-lockfile --filter @kimo/server \
  && apk add --no-cache su-exec \
  && chmod +x apps/server/docker-entrypoint.sh

ENV HOST=0.0.0.0 \
    PORT=8787 \
    KIMO_DATA_DIR=/data
VOLUME /data
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1

# Starts as root only to fix the ownership of a mounted volume, then runs as the `bun` user.
ENTRYPOINT ["/app/apps/server/docker-entrypoint.sh"]
CMD ["bun", "apps/server/src/main.ts"]
