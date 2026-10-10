---
id: T-0970
title: "Size split T22: packages/devtools/src/lead/batch.ts (913 lines) into lead/batch/{types,text,wave,parsers,check,report,merge,real}.ts, the old path a barrel"
status: todo
milestone: M5
branch: task/T-0970-split-lead-batch
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0970: Split `lead/batch.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `packages/devtools/src/lead/batch.ts` is 913 lines (`wc -l`, main, 2026-10-10). The plan read it at 910; T-0930 (`c26a3ce9`) changed it slightly since.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #18 (task T22): `lead/batch/types.ts`, `lead/batch/text.ts`, `lead/batch/wave.ts`, `lead/batch/parsers.ts`, `lead/batch/check.ts`, `lead/batch/report.ts`, `lead/batch/merge.ts`, `lead/batch/real.ts`, under `packages/devtools/src/`. `lead/batch.ts` becomes the barrel.

- **In scope:** the in-file Dedup, one `countKinds(outcome)`.
- **Out of scope:** `isRecord` → `lead/is-record.ts`, because it crosses files.

`lead batch check` must still work: run `pnpm exec tsx src/lead/cli.ts batch --help` (or the nearest no-side-effect command) in `packages/devtools`, and paste the output.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #18, and `packages/devtools/src/lead/batch.ts`.

### Allowed files
`packages/devtools/src/lead/batch.ts`, `packages/devtools/src/lead/batch/types.ts`, `packages/devtools/src/lead/batch/text.ts`, `packages/devtools/src/lead/batch/wave.ts`, `packages/devtools/src/lead/batch/parsers.ts`, `packages/devtools/src/lead/batch/check.ts`, `packages/devtools/src/lead/batch/report.ts`, `packages/devtools/src/lead/batch/merge.ts`, `packages/devtools/src/lead/batch/real.ts`, `work/T-0970-split-lead-batch.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for, plus the CLI output.

---

## Report (written by the worker when done)

## Review (written by Claude)
