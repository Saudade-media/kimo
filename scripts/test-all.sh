#!/usr/bin/env bash
# Runs every test directory in its own guarded bun process, one after another.
#
# One `bun test` over the whole repo keeps every file's heap alive until the end and passes 4 GB
# (mcp-server alone peaks near 3 GB), so scripts/safe-test.sh kills it. A fresh process per
# directory resets memory between them. Extra args (e.g. --bail) go to every run.
set -u
cd "$(dirname "$0")/.."
status=0
for dir in apps/*/ packages/*/ scripts/; do
  [ -n "$(find "$dir" -name '*.test.ts' -not -path '*/node_modules/*' -print -quit)" ] || continue
  echo "== $dir"
  scripts/safe-test.sh "./$dir" "$@" || status=$?
done
exit "$status"
