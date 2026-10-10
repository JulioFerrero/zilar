---
id: T-0985
title: "Size split T39: packages/devtools/src/lead/watch-app.tsx (735 lines) into lead/watch-app/{segments,lines,chrome,view,live}.tsx, the old path a barrel; one useSpinner"
status: todo
milestone: M5
branch: task/T-0985-split-lead-watch-app
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-0985: Split `lead/watch-app.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `packages/devtools/src/lead/watch-app.tsx` is 735 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #35 (task T39): `lead/watch-app/segments.tsx`, `lead/watch-app/lines.tsx`, `lead/watch-app/chrome.tsx`, `lead/watch-app/view.tsx`, `lead/watch-app/live.tsx`, under `packages/devtools/src/`. `lead/watch-app.tsx` becomes the barrel.

- **In scope:** the in-file Dedup. The two spinner-frame expressions become one `useSpinner()` in `segments.tsx`.
- **Already done:** T-0975 split `lead/watch.ts`, and it lazy-imports `../watch-app.js`. That path must still resolve.
- **Proof:** run `pnpm exec tsx src/lead/cli.ts watch --data` in `packages/devtools`, check that it still exits 0, and paste the first line of its output.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #35, `packages/devtools/src/lead/watch-app.tsx`, and `packages/devtools/src/lead/watch/cli.ts`.

### Allowed files
`packages/devtools/src/lead/watch-app.tsx`, `packages/devtools/src/lead/watch-app/segments.tsx`, `packages/devtools/src/lead/watch-app/lines.tsx`, `packages/devtools/src/lead/watch-app/chrome.tsx`, `packages/devtools/src/lead/watch-app/view.tsx`, `packages/devtools/src/lead/watch-app/live.tsx`, `work/T-0985-split-lead-watch-app.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for, plus the `watch --data` line.

---

## Report (written by the worker when done)

## Review (written by Claude)
