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

## What to test

In October 2026 the suite was cut roughly in half (3,741 unit cases to 1,935, ~430 e2e scenarios
to 9) because agent-written tests locked in code, slowed every run and caught little. Keep it
that way:

- Add a test only for (a) data integrity: file formats, schema validation, merge/CRDT convergence,
  undo grouping, anything that can corrupt or lose a file; (b) security and protocol: relay
  encryption, capability links, owner policy, auth, wire protocol; or (c) a real bug, reproduced by
  the test before the fix.
- Never test design values (pixels, CSS text, class names, colors, icon names, UI copy), static
  markup, constants, or mocks that mirror the implementation. A visual change is checked in the
  design file and in the running app, not in a test.
- Don't add a test file per task, milestone or board. Find the feature's file (named by feature,
  e.g. `apps/web/test/editor/clipboard.test.ts`) and add the one case there.
- When a test you didn't write fails after an intended change, update or delete it; don't bend
  the code to keep it passing.
- Keep the unit suite under 60 s in CI: no real waits when a clock or delay can be injected.
- e2e (`apps/web/e2e`) is a small Linux smoke set that runs on every PR. Extend it only for a
  core flow (canvas, text and pen, share and join), never for a measured design check.
