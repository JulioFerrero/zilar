---
id: T-1006
title: "Size split T79: apps/mobile/src/app/settings/connections.tsx (519 lines) into components/connections/{use-connections,connections-header,connection-card,add-connection-form}"
status: todo
milestone: M5
branch: task/T-1006-split-mobile-connections
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1006: Split the mobile connections screen

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/app/settings/connections.tsx` is 519 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #75 (task T79). The four new files go in `apps/mobile/src/components/connections/`:
- `use-connections.ts`;
- `connections-header.tsx`, `connection-card.tsx`, `add-connection-form.tsx`.

The screen keeps the ScrollView, the status and empty states, and its default export.

- **In scope:** the in-file part of the Dedup. `connection-card.tsx` replaces the inline provider-row copies.
- **Out of scope:** `row-errors.ts`, because it crosses files.
- **Existing files:** the folder already holds `connections-mock.ts`, `errors.ts`, `save-connection.ts` and `use-connections-api.ts`. Leave them as they are.
- **Same behaviour:** the provider API key field must keep never showing a saved key.

The lead runs a phone smoke of `/settings/connections` in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #75, and `apps/mobile/src/app/settings/connections.tsx`.

### Allowed files
`apps/mobile/src/app/settings/connections.tsx`, `apps/mobile/src/components/connections/use-connections.ts`, `apps/mobile/src/components/connections/connections-header.tsx`, `apps/mobile/src/components/connections/connection-card.tsx`, `apps/mobile/src/components/connections/add-connection-form.tsx`, `work/T-1006-split-mobile-connections.md`.

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
