#!/usr/bin/env bash
# Runs `bun test` with a wall-clock limit and a memory ceiling, so a runaway test cannot take
# the machine down (a leaking test once grew one bun process past 200 GB and panicked macOS).
#
#   scripts/safe-test.sh [bun test args...]
#
# Env: SAFE_TEST_TIMEOUT seconds for the whole run (default 900), SAFE_TEST_MAX_RSS_MB (default
# 4096), SAFE_TEST_PER_TEST_MS (default 10000, ignored when --timeout is passed).
# Exits 124 on timeout, 137 when the memory ceiling is hit, else bun's exit code.
set -u

TIMEOUT="${SAFE_TEST_TIMEOUT:-900}"
MAX_MB="${SAFE_TEST_MAX_RSS_MB:-4096}"
# A fixed path, not $TMPDIR (agents can get different TMPDIRs and would not see each other's lock).
LOCK_PARENT=/tmp
[ -w "$LOCK_PARENT" ] || LOCK_PARENT="${TMPDIR:-/tmp}"
LOCK_DIR="${KIMO_SAFE_TEST_LOCK:-$LOCK_PARENT/kimo-safe-test.lock}"

# One guarded run at a time per machine: parallel agents queue here instead of stacking bun processes.
waited=0
until mkdir "$LOCK_DIR" 2>/dev/null; do
  holder="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
    rm -rf "$LOCK_DIR"
    continue
  fi
  if [ "$waited" -ge "$TIMEOUT" ]; then
    echo "safe-test: waited ${TIMEOUT}s for another run (pid ${holder:-?}) to finish" >&2
    exit 124
  fi
  sleep 1
  waited=$((waited + 1))
done
echo $$ >"$LOCK_DIR/pid"

child=""
cleanup() {
  [ -n "$child" ] && kill_tree "$child"
  rm -rf "$LOCK_DIR"
}
trap cleanup EXIT INT TERM

# RSS in KB of a process and all its descendants.
tree_rss() {
  local pid="$1" total kids k
  total="$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ')"
  total="${total:-0}"
  kids="$(pgrep -P "$pid" 2>/dev/null || true)"
  for k in $kids; do total=$((total + $(tree_rss "$k"))); done
  echo "$total"
}

kill_tree() {
  local pid="$1" k
  for k in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$k"; done
  kill -9 "$pid" 2>/dev/null || true
}

# Per-test limit unless the caller sets one (bunfig.toml only applies from the repo root).
case " $* " in
  *" --timeout"*) bun test "$@" & ;;
  *) bun test --timeout "${SAFE_TEST_PER_TEST_MS:-10000}" "$@" & ;;
esac
child=$!
start=$SECONDS
max_kb=$((MAX_MB * 1024))

while kill -0 "$child" 2>/dev/null; do
  rss="$(tree_rss "$child")"
  if [ "$rss" -gt "$max_kb" ]; then
    echo "safe-test: killed bun test, RSS $((rss / 1024)) MB > ${MAX_MB} MB" >&2
    kill_tree "$child"
    child=""
    exit 137
  fi
  if [ $((SECONDS - start)) -ge "$TIMEOUT" ]; then
    echo "safe-test: killed bun test after ${TIMEOUT}s" >&2
    kill_tree "$child"
    child=""
    exit 124
  fi
  sleep 0.1
done

wait "$child"
code=$?
child=""
exit "$code"
