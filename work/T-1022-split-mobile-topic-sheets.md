---
id: T-1022
title: "Size split T100: apps/mobile/src/components/chat/topic-sheets.tsx (442 lines) into chat/{topic-actions-sheet,topic-info-sheet}; one RetryRow"
status: todo
milestone: M5
branch: task/T-1022-split-mobile-topic-sheets
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1022: Split the mobile topic sheets

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/chat/topic-sheets.tsx` is 442 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #96 (task T100): `components/chat/topic-actions-sheet.tsx` and `chat/topic-info-sheet.tsx`, under `apps/mobile/src/`. `topic-sheets.tsx` re-exports every name it exports today.

- **In scope:** the in-file Dedup. The two error-plus-Retry blocks (roles and group roles) become one `RetryRow`, and each keeps its own text and retry call.

The lead runs a phone smoke of a Dev team topic's actions and info sheets in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #96, and `apps/mobile/src/components/chat/topic-sheets.tsx`.

### Allowed files
`apps/mobile/src/components/chat/topic-sheets.tsx`, `apps/mobile/src/components/chat/topic-actions-sheet.tsx`, `apps/mobile/src/components/chat/topic-info-sheet.tsx`, `work/T-1022-split-mobile-topic-sheets.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
