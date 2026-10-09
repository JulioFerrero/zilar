---
id: T-0657
title: "Spike: typecheck apps/server and packages/protocol with tsgo (TypeScript's native compiler) through pnpm dlx and compare errors, time and peak memory with tsc; report only, no repo change"
status: merged
milestone: M5
branch: task/T-0657-tsgo-spike
model: auto
effort: low
depends_on: []
estimate: 0.25 day
---

# T-0657: tsgo spike

## Spec (written by Claude, do not edit)

### Why
Julio asked (2026-10-09) to try tsgo, TypeScript's native compiler. It should be much faster and lighter than `tsc`, which the gate runs in every package. Before any switch, we need to know two things:
- does tsgo accept our Effect 4 code with the same result as `tsc`?
- how much time and memory does it save?

**This task only measures and reports. It changes no file except this task file.**

### Verified facts (do not re-derive)
- Each package typechecks with `tsc --noEmit`: for example, `apps/server/package.json:9` and `packages/protocol/package.json:10`. `apps/web` runs two projects (`apps/web/package.json:11`).
- tsgo is published on npm as `@typescript/native-preview`; its binary is `tsgo`.

### What to build
1. **In `apps/server`, then `packages/protocol`:**
   - run `/usr/bin/time -l pnpm exec tsc --noEmit` and `/usr/bin/time -l pnpm dlx @typescript/native-preview tsgo --noEmit`, one after the other, never at the same time;
   - record for each run the exit code, the number of errors, the wall time and the "maximum resident set size".
2. **If tsgo reports errors that tsc does not (or the reverse),** list the first 10 with `file:line` and the message.
3. **Write the results** in the Report as a table: package, compiler, exit code, errors, seconds and peak MB. Add a short verdict:
   - whether tsgo can replace `tsc` in the gate as it is;
   - or what blocks it, for example Effect types or a missing compiler option.
4. **Do not add dependencies or change any config.** Run nothing in parallel.

### Read first
`AGENTS.md`, `apps/server/package.json`, `apps/server/tsconfig.json`, `tsconfig.base.json`.

### Allowed files
`work/T-0657-tsgo-spike.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Report has the table for both packages and a clear verdict.
- `pnpm gate` ends with GATE PASS, and the only changed file is this task file.

---

## Report (written by the worker when done)

### What I did
- Ran `pnpm install` first (13 workspace projects, 1173 packages, done in 10.5s).
- For `apps/server` then `packages/protocol`, ran `tsc --noEmit` and `tsgo --noEmit` one after the other, never at the same time, each wrapped in `/usr/bin/time -l`. Recorded exit code, error count, wall seconds and "maximum resident set size".
- `pnpm gate` from the repo root.
- No repo change: the only modified file is this task file.

### Versions measured
- `tsc`: 6.0.3 (`pnpm exec tsc --version`).
- `tsgo`: 7.0.0-dev.20260707.2 (`pnpm dlx @typescript/native-preview --version`), from npm `@typescript/native-preview`.

### Results
`/usr/bin/time -l`, peak MB = "maximum resident set size" / 1048576.

| Package | Compiler | Exit code | Errors | Seconds | Peak MB |
| --- | --- | --- | --- | --- | --- |
| apps/server | tsc 6.0.3 | 0 | 0 | 8.94 | 1200 |
| apps/server | tsgo 7.0.0-dev.20260707.2 | 0 | 0 | 4.76 | 1176 |
| packages/protocol | tsc 6.0.3 | 0 | 0 | 2.11 | 361 |
| packages/protocol | tsgo 7.0.0-dev.20260707.2 | 0 | 0 | 0.51 | 143 |

Raw "maximum resident set size" bytes: server tsc 1258651648, server tsgo 1233469440, protocol tsc 379043840, protocol tsgo 150061056.

### Errors: tsc vs tsgo
tsgo reports exactly the same as tsc on both packages: 0 errors each. There are no differences to list (nothing to put in a first-10 list).

### Verdict
- **tsgo accepts our Effect 4 code with the same result as tsc**, so no Effect-type or missing-option blocker: both packages typecheck clean under tsgo.
- **Speed:** tsgo is clearly faster — about 1.9x on `apps/server` (8.94s -> 4.76s) and about 4.1x on `packages/protocol` (2.11s -> 0.51s).
- **Memory:** only a clear win on the small package: `packages/protocol` 361 -> 143 MB (about 2.5x lighter). On `apps/server` the saving is negligible (1200 -> 1176 MB, under 3%).
- **Can it replace tsc in the gate as-is?** Yes, functionally it can (same zero-error result), and it would cut wall time, especially on small packages. Two caveats before switching: (1) the exact command in the spec does not work and must be written as `pnpm dlx @typescript/native-preview --noEmit` (see deviation below); (2) it is a `-dev` preview release (`7.0.0-dev.20260707.2`) versus the stable `tsc 6.0.3`, so pinning and re-checking at install time is needed. With a <3% memory saving on `apps/server`, the case for switching is about wall time, not memory.

### Deviations from the spec
- **The literal command `/usr/bin/time -l pnpm dlx @typescript/native-preview tsgo --noEmit` fails on both packages** with exit code 1 and `error TS5112: tsconfig.json is present but will not be loaded if files are specified on commandline. Use '--ignoreConfig' to skip this error.` `pnpm dlx <package> <args...>` passes every token after the package name to the package's default bin, so `tsgo` is treated as a file argument, not as a command. I measured instead with the corrected form `/usr/bin/time -l pnpm dlx @typescript/native-preview --noEmit`, which runs the `tsgo` binary and produced the 0-error result above. (No files were emitted: `tsconfig.base.json` sets `noEmit: true`; `git status` stayed clean.)
- Memory is measured around the `pnpm` wrapper exactly as the spec asks, so a small amount of pnpm/node process memory is included; this is identical for tsc and tsgo, so the comparison is like-for-like.

### Files changed
- `work/T-0657-tsgo-spike.md` (this file) only. `git status --porcelain` shows ` M work/T-0657-tsgo-spike.md` and nothing else.

### Commands run (real results)
- `pnpm install`: done in 10.5s, 13 projects, 1173 packages.
- `apps/server`: `tsc --noEmit` exit 0, 0 errors, 8.94s, 1258651648 B peak. `pnpm dlx @typescript/native-preview --noEmit` (tsgo) exit 0, 0 errors, 4.76s, 1233469440 B peak. Literal `... tsgo --noEmit` exit 1, TS5112.
- `packages/protocol`: `tsc --noEmit` exit 0, 0 errors, 2.11s, 379043840 B peak. tsgo exit 0, 0 errors, 0.51s, 150061056 B peak. Literal `... tsgo --noEmit` exit 1, TS5112.
- No package test files were run individually (this spike changes no code); the only test run is the one inside `pnpm gate`.
- `pnpm gate` summary lines:
  ```
  gate: 1 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (13.4s)
  PASS  lint  (0.8s)
  PASS  typecheck  (1.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Blocked / needs a decision
None.

### Open questions
- Do we want to pin `@typescript/native-preview` in the gate, given it is a `-dev` preview release, or wait for a stable tsgo?

## Review (written by Claude)

**2026-10-09, lead:** approved.
- **Pre-review:** clean. The packet head is ead7bf09, the current HEAD.
- **Result:**
  - tsgo (7.0.0-dev) gives the same 0-error result as tsc 6.0.3;
  - it is 1.9x faster on server and 4.1x on protocol;
  - server memory is about the same.
- **Lead decision:** no switch yet. T-0655 already cut each gate to the affected packages, and tsgo is a dev preview. Revisit when the load measurements after T-0656 are in.
