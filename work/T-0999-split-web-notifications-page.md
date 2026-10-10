---
id: T-0999
title: "Size split T67: apps/web/src/routes/NotificationsPage.tsx (551 lines) into lib/push/{deviceStorage,pageActions,usePushEnable} and components/push/{ThisDeviceCard,DevicesSection,PreviewsSection}"
status: todo
milestone: M5
branch: task/T-0999-split-web-notifications-page
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-0999: Split `NotificationsPage.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/routes/NotificationsPage.tsx` is 551 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #63 (task T67). The new files go in two new folders under `apps/web/src/`:
- `lib/push/`: `deviceStorage.ts`, `pageActions.ts`, `usePushEnable.ts`;
- `components/push/`: `ThisDeviceCard.tsx`, `DevicesSection.tsx`, `PreviewsSection.tsx`.

The page keeps every export it has today.

- **Skip the Dedup:** moving `attempt`/`quietly`/`runPageAction` to the shared `lib/effect` crosses files. They go to `lib/push/pageActions.ts` unchanged.
- **The push secrets:** the subscription and its keys are handled exactly as now.

The lead checks the page in Chrome in mock mode.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #63, and `apps/web/src/routes/NotificationsPage.tsx`.

### Allowed files
`apps/web/src/routes/NotificationsPage.tsx`, `apps/web/src/lib/push/deviceStorage.ts`, `apps/web/src/lib/push/pageActions.ts`, `apps/web/src/lib/push/usePushEnable.ts`, `apps/web/src/components/push/ThisDeviceCard.tsx`, `apps/web/src/components/push/DevicesSection.tsx`, `apps/web/src/components/push/PreviewsSection.tsx`, `work/T-0999-split-web-notifications-page.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, the Report has everything `split-rules.md` item 8 asks for, and the Report names the page's route.

---

## Report (written by the worker when done)

## Review (written by Claude)
