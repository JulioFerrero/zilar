---
id: T-0808
title: "WU9: web NotificationsPage and GroupHandleRoute on Effect (push permission flow, storage and JSON reads, the handle debounce)"
status: todo
milestone: M5
branch: task/T-0808-web-notifications
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0808: WU9: web NotificationsPage and GroupHandleRoute on Effect (push permission flow, storage and JSON reads, the handle debounce)

## Spec (written by Claude, do not edit)

### Why
This is part of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09. It runs in **wave 1** of the batch mode Julio chose on 2026-10-09: the lead checks the whole wave once and sends every failure back. Plan row WU9 (line 379); WU3 (the lib ports, T-0794) is merged. The plan flags "Julio: push permission flow": Julio checks it live.

### Verified facts (do not re-derive)
- **`apps/web/src/routes/NotificationsPage.tsx`** (519, H1 H5 W4 W6), tested in `NotificationsPage.test.tsx`. The first try is at line 42. It also reads storage (H5) and calls `JSON.parse` (W6): storage goes through `Effect.try` with `runSync` at a synchronous edge, as `apps/web/src/lib/topicsUi.ts` does (T-0772), and `JSON.parse` becomes a Schema decode (`Schema.UnknownFromJsonString` or the 4.0.2 equivalent; check `Schema.d.ts`).
- **`apps/web/src/routes/GroupHandleRoute.tsx`** (223, H1 H3 W4), tested in `GroupHandleRoute.test.tsx`, with a `setTimeout` at line 50.
- **Push calls go through `apps/web/src/lib/push.ts`,** which keeps its Promise API and now exports `*Effect` versions (T-0794); use those where convenient.
- **The click stays synchronous:** `Notification.requestPermission()` must be called inside the click handler, as `docs/EFFECT_BRIEF.md` says for browser APIs that need the user's click.

### What to build
Convert both files with the web pattern.

Follow `docs/EFFECT_BRIEF.md` (the wave rules, the building blocks and the traps).

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, `apps/web/src/lib/push.ts`, `apps/web/src/lib/topicsUi.ts`, `apps/web/src/lib/effect/use-action.ts`, `use-query.ts`, the two files and their tests.

### Allowed files
`apps/web/src/routes/NotificationsPage.tsx`, `apps/web/src/routes/GroupHandleRoute.tsx`, `work/T-0808-web-notifications.md`.

### Checks (wave mode: your own tests and your package typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/web exec vitest run --reporter=dot src/routes/NotificationsPage src/routes/GroupHandleRoute
pnpm --filter @zilar/web typecheck
```
Run the tests 3 times when the code has timers or concurrency. Run `pnpm exec prettier --write` on your changed files before committing.

### Acceptance
- Each listed source file is `effect` (or carries a valid marker where the task says so) in `pnpm effect:map`.
- Exported names, signatures, texts and behaviour are unchanged, or each difference is listed in the Report.
- Existing tests pass unchanged; new tests pass; the package typecheck is clean.
- Only Allowed files change.

---

## Report (written by the worker when done)

## Review (written by Claude)
