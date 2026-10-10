---
id: T-0905
title: "Store core T4: the mobile store on the core lifetime (makeLife and makeRunners as adapters, keyed fibers for typing, refresh and draft timers)"
status: todo
milestone: M5
branch: task/T-0905-store-core-t4-mobile-lifetime
model: auto
effort: default
depends_on: [T-0903]
estimate: 0.75 day
---

# T-0905: Store core T4, mobile on the core lifetime

## Spec (written by Claude, do not edit)

### Why
This is task T4 of `docs/STORE_CORE_PLAN.md` (section 6, "T4: mobile on the core lifetime (mobile)"), with the mobile adapter described at the end of section 3. Follow both exactly. Its risk is medium-high, because it touches resume and drafts.

The lead re-checked the lines on main on 2026-10-10. Merges moved them, so they differ from the plan:
- `apps/mobile/src/store/real-store.ts` calls `makeLife()` at `:256` and `makeRunners(ports, life)` at `:1678`; it is not touched in this task.
- `apps/mobile/src/store/effects/events.ts` keeps typing timers in a `Map` at `:57-58` and the refresh timer at `:58-144`.
- `apps/mobile/src/store/effects/polling.ts` has the poll Scopes `topicsScope` and `pinsScope` at `:57-100`, and the `draftTimeouts` map at `:127-185`.

This branch starts from `task/T-0903-store-core-t2-lifetime`, which adds `packages/client-core/src/store/lifetime.ts`.

### What to build
1. **`apps/mobile/src/store/effects/runtime.ts`:** `makeLife` and `makeRunners` become adapters over the core lifetime, as plan section 3 maps them. Keep the same exports and signatures, so `real-store.ts` and `effects/runtime.test.ts` stay unchanged:
   - `life.session()` is the store Scope;
   - `life.generation()` is the current session Scope;
   - `restartGeneration()` is `beginSession()`;
   - `endSession()` is `closeStore()`.
2. **`effects/events.ts`:** the typing and refresh timers become `forkKeyed` and cancel calls; the hand-kept `Map` and timer variable go.
3. **`effects/polling.ts`:** the draft timeouts become `forkKeyed`. The two poll Scopes become core sessions or keyed fibers, whichever the plan's mapping gives; say which.
4. **Unchanged:** behaviour and the existing tests.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/T-0905/`; use `@/test/wait` helpers, never raw `setTimeout(resolve, 0)`), `docs/STORE_CORE_PLAN.md` sections 3, 4 and 6, `packages/client-core/src/store/lifetime.ts` with its test, and the three mobile files with their tests.

### Allowed files
`apps/mobile/src/store/effects/runtime.ts`, `apps/mobile/src/store/effects/events.ts`, `apps/mobile/src/store/effects/polling.ts`, `work/T-0905-store-core-t4-mobile-lifetime.md`, plus T-0903's files carried by the base branch: `packages/client-core/src/store/lifetime.ts`, `packages/client-core/src/store/lifetime.test.ts`, `packages/client-core/src/store/index.ts`, `apps/web/src/store/effects/runtime.ts` and `work/T-0903-store-core-t2-lifetime.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store/effects
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store
pnpm --filter @zilar/mobile typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
ZILAR_SMOKE_DIR=<scratchpad>/T-0905/smoke ZILAR_ROUTES="/ /settings" pnpm phone:smoke task/T-0905-store-core-t4-mobile-lifetime
```
Run the mobile `src/store` tests 3 times, because they use timers. The guards are listed in plan section 6 T4: `runtime.test.ts`, `events.test.ts`, `history.test.ts`, `send.test.ts`, the resume, boot and drafts parts of `real-store.test.ts`, and `integration.test.ts`.

### Acceptance
- The Checks pass, 3 runs, and the phone smoke is clean.
- No existing test is edited.
- The Report gives the lines per side and the poll Scope mapping.
- Live check for Julio: AI draft streaming and resume after backgrounding the app, on the phone.

---

## Report (written by the worker when done)

## Review (written by Claude)
