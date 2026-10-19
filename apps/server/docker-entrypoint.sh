#!/bin/sh
# Mounted volumes (Fly.io, Railway, docker -v) are often root-owned: fix that, then drop privileges.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${KIMO_DATA_DIR:-/data}"
  chown -R bun:bun "${KIMO_DATA_DIR:-/data}"
  exec su-exec bun:bun "$@"
fi
exec "$@"
