#!/usr/bin/env bun
/** The `kimo` executable (`bunx kimo …`, `bun packages/cli/src/main.ts …`). */
import { run } from "./cli"

process.exitCode = await run(process.argv.slice(2))
