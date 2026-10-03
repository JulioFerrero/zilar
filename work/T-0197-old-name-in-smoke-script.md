---
id: T-0197
title: Remove the old product name from the emulator smoke script (main's legacy-name test is red)
status: planned
milestone: M5
branch: task/T-0197-old-name-in-smoke-script
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0197: Remove the old product name from the emulator smoke script

## Spec (written by Claude, do not edit)

### Why
`packages/devtools/src/no-legacy-name.test.ts` fails on `main`: it forbids the product's old name in tracked files, and `scripts/phone/smoke.sh` line 23 has it in an error message (the emulator's AVD happens to carry the old name). Any task that touches `packages/devtools` fails its gate until this is fixed.

### What to build
1. In `scripts/phone/smoke.sh`, change the error message on line 23 so it does not name the AVD. Use: `emulator $SERIAL is not running (start it from Android Studio or with emulator -avd <name>; list the names with emulator -list-avds)`. Change nothing else in the file.
2. Do not add an exception to the test.

### Read first
`AGENTS.md`, `packages/devtools/src/no-legacy-name.test.ts`, `scripts/phone/smoke.sh`.

### Allowed files
`scripts/phone/smoke.sh`, `work/T-0197-old-name-in-smoke-script.md`.

### Checks
```bash
pnpm install --frozen-lockfile
bash -n scripts/phone/smoke.sh
pnpm format:check
pnpm --filter @zilar/devtools test --maxWorkers=2 src/no-legacy-name
pnpm gate
```

### Acceptance
- `src/no-legacy-name` passes; `bash -n` passes; `pnpm gate` ends with GATE PASS.

### Out of scope
Any other change.

---

## Report (written by the worker when done)

## Review (written by Claude)
