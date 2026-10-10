---
id: T-1005
title: "Size split T78: apps/mobile/src/app/settings/profile.tsx (521 lines) into components/settings/{use-profile-settings,name-field}"
status: todo
milestone: M5
branch: task/T-1005-split-mobile-profile
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1005: Split the mobile profile screen

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/app/settings/profile.tsx` is 521 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #74 (task T78): `components/settings/use-profile-settings.ts` and `settings/name-field.tsx`, under `apps/mobile/src/`.

- **The screen keeps:** `SettingsScreenShell`, the status and HandleField wiring, and its default export.
- **Skip the Dedup:** `attempt-with-message.ts` crosses files to `machines`.
- **Existing files:** the folder already holds other files. Leave them as they are.
- **The 400-line limit:** if `use-profile-settings.ts` comes out over 400 lines, split it once more inside `components/settings/` (for example `use-profile-avatar.ts`), and name the new file in the Report.

The lead runs a phone smoke of `/settings/profile` in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #74, and `apps/mobile/src/app/settings/profile.tsx`.

### Allowed files
`apps/mobile/src/app/settings/profile.tsx`, `apps/mobile/src/components/settings/use-profile-settings.ts`, `apps/mobile/src/components/settings/use-profile-avatar.ts`, `apps/mobile/src/components/settings/name-field.tsx`, `work/T-1005-split-mobile-profile.md`.

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
