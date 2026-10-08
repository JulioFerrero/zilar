---
id: T-0657
title: "Spike: typecheck apps/server and packages/protocol with tsgo (TypeScript's native compiler) through pnpm dlx and compare errors, time and peak memory with tsc; report only, no repo change"
status: todo
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

## Review (written by Claude)
