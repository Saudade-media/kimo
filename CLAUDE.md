# Kimo: notes for agents

## Test safety

A runaway `bun test` once grew past 200 GB and kernel-panicked the Mac (several agents ran tests in
parallel, and one test streamed an endless body from `Bun.serve`). So:

- Run tests only through `scripts/safe-test.sh` (or `bun run test`, which uses it). It kills the
  run at 4 GB RSS or after 15 minutes, applies a 10 s per-test timeout, and holds a machine-wide
  lock so only one guarded run happens at a time.
  - One file: `scripts/safe-test.sh ./packages/sync/test/mp/http.test.ts`
  - Tighter limits: `SAFE_TEST_MAX_RSS_MB=1024 SAFE_TEST_TIMEOUT=60 scripts/safe-test.sh <file>`
  - Whole repo: `bun run test` (scripts/test-all.sh) runs one guarded process per workspace, because a
    single process over everything passes 4 GB.
- Never run bare `bun test`, and never run tests from several agents in parallel.
- Put scratch or throwaway tests in the OS temp dir, not in the repo, and delete them when done.
- Test fakes must be bounded: no endless `ReadableStream` sources, no unbounded loops or retries.
  Pace and cap anything that produces data until cancelled.
