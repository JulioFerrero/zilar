---
id: T-0975
title: "Size split T27: packages/devtools/src/lead/watch.ts (818 lines) into lead/watch/{live-step,changed-files,format,speed,view,collect,cli}.ts, the old path a barrel"
status: todo
milestone: M5
branch: task/T-0975-split-lead-watch
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0975: Split `lead/watch.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `packages/devtools/src/lead/watch.ts` is 818 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #23 (task T27): `lead/watch/live-step.ts`, `lead/watch/changed-files.ts`, `lead/watch/format.ts`, `lead/watch/speed.ts`, `lead/watch/view.ts`, `lead/watch/collect.ts`, `lead/watch/cli.ts`, under `packages/devtools/src/`. `lead/watch.ts` becomes the barrel.

Skip the entry's Dedup (`findRepoRoot` and `isRecord`), because it crosses files.

`lead watch` must still start. Run `pnpm exec tsx src/lead/cli.ts watch --once` in `packages/devtools`, or the nearest one-shot, no-side-effect form (read `cli.ts`), and paste the first lines of output.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #23, and `packages/devtools/src/lead/watch.ts`.

### Allowed files
`packages/devtools/src/lead/watch.ts`, `packages/devtools/src/lead/watch/live-step.ts`, `packages/devtools/src/lead/watch/changed-files.ts`, `packages/devtools/src/lead/watch/format.ts`, `packages/devtools/src/lead/watch/speed.ts`, `packages/devtools/src/lead/watch/view.ts`, `packages/devtools/src/lead/watch/collect.ts`, `packages/devtools/src/lead/watch/cli.ts`, `work/T-0975-split-lead-watch.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for, plus the watch output.

---

## Report (written by the worker when done)

## Review (written by Claude)
