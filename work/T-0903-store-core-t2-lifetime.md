---
id: T-0903
title: "Store core T2: the lifetime (store and session Scopes, keyed fibers) in packages/client-core, web runtime on it"
status: merged
milestone: M5
branch: task/T-0903-store-core-t2-lifetime
model: auto
effort: default
depends_on: [T-0902]
estimate: 0.5 day
---

# T-0903: Store core T2, the lifetime

## Spec (written by Claude, do not edit)

### Why
This is task T2 of `docs/STORE_CORE_PLAN.md` (section 6, "T2: the lifetime in core (core + web)"). The design is in section 3, "One lifetime design". Follow both exactly.

The lead re-checked the cited lines on 2026-10-10. `makeLifetime` is at `apps/web/src/store/effects/runtime.ts:78`.

This branch starts from `task/T-0902-store-core-t1-rows`, which adds the `@zilar/client-core/store` subpath and `packages/client-core/src/store/index.ts` with one section per task. T-0904 (T3) runs in parallel in its own section.

### What to build
1. **Core:** new `packages/client-core/src/store/lifetime.ts` and `packages/client-core/src/store/lifetime.test.ts`, plus one line in the T2 section of `packages/client-core/src/store/index.ts`. Section 3 of the plan sets the API:
   - `makeLifetime` takes a `Context.Context<R>`;
   - `fork` and `forkKeyed` return the fiber;
   - `Fibers.onClose` and `Fibers.isOpen` are added.
2. **Core tests** carry the mobile cases from section 3:
   - finalizers run once;
   - a closed session reads as closed;
   - a rollback handler never runs on interruption (turn T-0896's probe into a test).
3. **Web:** `apps/web/src/store/effects/runtime.ts` becomes a thin adapter, `makeLifetime(ports) = core.makeLifetime(Context.make(Ports, ports))`, plus the type re-exports.
4. **Unchanged:** behaviour, and the existing tests.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/T-0903/`), `docs/STORE_CORE_PLAN.md` sections 3, 4 and 6, `apps/web/src/store/effects/runtime.ts` with its test, and `apps/mobile/src/store/effects/runtime.ts` with its test.

### Allowed files
`packages/client-core/src/store/lifetime.ts`, `packages/client-core/src/store/lifetime.test.ts`, `packages/client-core/src/store/index.ts` (T2 section only), `apps/web/src/store/effects/runtime.ts`, `work/T-0903-store-core-t2-lifetime.md`.

T-0902's files are carried by the base branch: `packages/client-core/package.json`, `packages/client-core/src/store/**`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `package.json`, `apps/*/package.json`, `packages/*/package.json`, `apps/web/src/store/effects/chatRows.ts`, `apps/web/src/store/effects/polling.ts`, `apps/web/src/store/effects/constants.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/effects/polling.ts`, `work/T-0900-deps-catalog.md` and `work/T-0902-store-core-t1-rows.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store/effects/runtime.test.ts
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store
pnpm --filter @zilar/client-core typecheck
pnpm --filter @zilar/web typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Run `src/store/realStore.test.tsx` 3 times.

### Acceptance
- The Checks pass, and the existing tests are unchanged.
- The core tests cover the three mobile cases.
- The Report gives the lines per side.

---

## Report (written by the worker when done)

**Done.** Core `makeLifetime<R>(Context.Context<R>)` in `packages/client-core/src/store/lifetime.ts` (web's code made generic). `fork` and `forkKeyed` return the fiber; `Fibers` gained `onClose` and `isOpen` (`scope.state._tag !== 'Closed'`). Index line added in the T2 section. Web `runtime.ts` is now an adapter: `makeLifetime(ports) = core(Context.make(Ports, ports))` plus `Task`, `Fibers`, `Lifetime` aliases bound to `Ports`.

**Lines per side:** core 120 (lifetime.ts) + 105 (lifetime.test.ts) + 1 (index); web runtime.ts 126 -> 18 (14 added, 113 deleted).

**New core tests (7):** fork returns fiber and runs inline; forkKeyed returns fiber; store end runs finalizers once, no timer left; closed session reads closed (`isOpen`); replaced session runs only its own finalizer; rollback handler (`catchCause` and `catch`) never runs on interruption (T-0896 probe); failing task is logged and does not stop others.

**Differences from the plan:** web keeps `onStoreClose` and `isStoreOpen` on `Lifetime` (the core has them too, `onStoreClose` calls `Fibers.onClose`), so web callers and tests are untouched. Fork return type is `Fiber<unknown, never>` because the guard catches every cause.

**Checks run:** client-core vitest 68 passed; web `runtime.test.ts` 5 passed; web `src/store` 214 passed (16 files); `realStore.test.tsx` x3: 134 passed each time; both typechecks clean; prettier and oxlint clean. `pnpm gate` not run (wave mode).

## Review (written by Claude)

**Lead, 2026-10-10: approved.**
- **Core lifetime:** `lifetime.ts` has 7 new tests. They cover a fork returning its fiber, finalizers running once, `isOpen`, replaced sessions, rollback handlers never running on interruption, and a failing fork being isolated.
- **Web:** `runtime.ts` drops from 126 to 18 lines as an adapter. `runtime.test.ts` and `realStore.test.tsx` pass unedited, the latter 3 times.
- **No behaviour change.** T4 (mobile on the core lifetime) can follow.
- **Check:** the combined wave 6 check passes.
