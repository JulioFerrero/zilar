---
id: T-1037
title: "Size split T119: apps/site/src/instruments.ts (405 lines) into instruments/{dom,approval,routine,provider,pairing,sheen}.ts, the old path keeps initInstruments"
status: todo
milestone: M5
branch: task/T-1037-split-site-instruments
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1037: Split the site's `instruments.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/site/src/instruments.ts` is 405 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #115 (task T119). The new files go in a new `apps/site/src/instruments/` folder:
- `dom.ts`;
- `approval.ts`;
- `routine.ts`;
- `provider.ts`;
- `pairing.ts`;
- `sheen.ts`.

`apps/site/src/instruments.ts` stays at its path, because `apps/site/src/main.ts:6` imports `initInstruments` from it. It keeps `initInstruments` and every export it has today.

The in-file Dedup is in scope: `required`, `reducedMotion` and `clockTime` live once in `dom.ts`, and the feature modules import them.

The lead checks the site's demo instruments in a headless browser against main.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #115, and `apps/site/src/instruments.ts`.

### Allowed files
`apps/site/src/instruments.ts`, `apps/site/src/instruments/dom.ts`, `apps/site/src/instruments/approval.ts`, `apps/site/src/instruments/routine.ts`, `apps/site/src/instruments/provider.ts`, `apps/site/src/instruments/pairing.ts`, `apps/site/src/instruments/sheen.ts`, `work/T-1037-split-site-instruments.md`.

### Checks
```bash
pnpm --filter @zilar/site build
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
