---
id: T-1555
title: "Split packages/client-core/src/store/lifecycle.ts (400 lines, the limit): the XMPP connect block (scheduleConnectRetry, subscribeToCore, connectXmpp) moves to store/connect.ts; lifecycle.ts keeps boot, reconnect, stop and reset and every export; no behaviour change"
status: merged
milestone: M5
branch: task/T-1555-split-client-core-lifecycle
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1555: Split client-core lifecycle.ts

## Spec (written by Claude, do not edit)

### Why
`packages/client-core/src/store/lifecycle.ts` is exactly 400 lines. Web and phone share it to boot, connect and reconnect, which is the message pipeline. **Follow `docs/audit/split-rules.md`.** The old `size-plan.md` entry #114 is stale (the file has already lost `last-read`, `suspend`, `online` and `session-check`), so this spec names the cut.

### Facts (the lead read them on main, 2026-10-15)
- **Re-exports (`:40-44`):** `readLastRead`, `suspendStore`, `wakeCore`, `flushOnline`, `onAuthFailed` and `SessionCheck`.
- **Exports:**
  - `CONNECT_RETRY_DELAYS_MS` (`:47`), `LifecycleBoot` (`:50`), `LifecycleCtx` (`:58`);
  - `startStore` (`:73`), `retryBoot` (`:85`), `stopStore` (`:116`), `reset` (`:133`), `reconnect` (`:157`).
- **Internal:** `beginBoot` (`:98`) and `boot` (`:203`); `boot` calls `connectXmpp` (`:254`).
- **The connect block (`:256-400`):**
  - `scheduleConnectRetry` (`:260-290`, with its comment from `:256`);
  - `subscribeToCore` (`:292-334`), which passes `scheduleConnectRetry` to `onAuthFailed` (`:308`);
  - `connectXmpp` (`:336-400`).
  - They call each other and use `CONNECT_RETRY_DELAYS_MS`.

### Steps
1. **New `packages/client-core/src/store/connect.ts`:**
   - move the three functions unchanged, with their comments, and export `connectXmpp`. Export the other two only if `lifecycle.ts` needs them;
   - move `CONNECT_RETRY_DELAYS_MS` there too, and re-export it from `lifecycle.ts`;
   - import `LifecycleCtx` as a **type** from `./lifecycle`;
   - **no value import from `./lifecycle`**, so there is no runtime cycle. If a moved function needs a value that lives in `lifecycle.ts` (for example `reset`), stop and report it instead of making a cycle.
2. **`lifecycle.ts`** imports `connectXmpp` from `./connect` and keeps every export and re-export.
3. **No behaviour change.** The client-core store tests and the web realStore tests must pass in the gate.

### Allowed files
- `packages/client-core/src/store/lifecycle.ts`
- `packages/client-core/src/store/connect.ts` (new)
- `work/T-1555-split-client-core-lifecycle.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The Report gives:**
  - the `wc -l` of both files;
  - the export list of `lifecycle.ts` before and after (identical);
  - the gate summary.

---

## Report (written by the worker when done)

### What I did

Followed `docs/audit/split-rules.md`. Moved the XMPP connect block out of
`packages/client-core/src/store/lifecycle.ts` into the new
`packages/client-core/src/store/connect.ts`, code unchanged:

- `CONNECT_RETRY_DELAYS_MS`, `scheduleConnectRetry`, `subscribeToCore` and
  `connectXmpp`, with their comments, in that order.
- `connect.ts` exports `connectXmpp` and `CONNECT_RETRY_DELAYS_MS`;
  `scheduleConnectRetry` and `subscribeToCore` stay module-private because only
  the connect block uses them.
- `connect.ts` takes `LifecycleCtx` and `Fibers` as **type-only** imports from
  `./lifecycle` and `./lifetime`; nothing moved uses a runtime value from
  `lifecycle.ts` (no `reset`), so there is no runtime cycle. The only value edge
  is `lifecycle.ts -> connect.ts`.
- `lifecycle.ts` now imports `connectXmpp` from `./connect` for `boot`, and
  re-exports `CONNECT_RETRY_DELAYS_MS` from `./connect` in the existing
  re-export block. Removed the imports that only the moved code used
  (`Scope`, `trustedMediaHosts`, `@zilar/xmpp-core`, `./delivered`, `./previews`,
  the `handle*` functions from `./incoming`, `CoreMe`, the `onAuthFailed` value
  import, `./rows`, and `markReboundOutbox`/`scheduleChatsRefreshBurst`).

### Files changed

- `packages/client-core/src/store/lifecycle.ts` (modified)
- `packages/client-core/src/store/connect.ts` (new)
- `work/T-1555-split-client-core-lifecycle.md` (this report)

### Sizes (`wc -l`)

- before: `lifecycle.ts` 400 lines
- after: `lifecycle.ts` 240 lines, `connect.ts` 177 lines (both < 400)

### Export list of `lifecycle.ts` before and after (`grep -E "^export"`)

Before (10 names + 2 types + 5 re-exports):
```
export { readLastRead } from './last-read';
export { suspendStore, wakeCore } from './suspend';
export { flushOnline } from './online';
export { onAuthFailed, type SessionCheck } from './session-check';
export const CONNECT_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
export interface LifecycleBoot { ... }
export interface LifecycleCtx extends HistoryCtx, DraftTurns { ... }
export const startStore = ...
export const retryBoot = ...
export const stopStore = ...
export function reset ...
export const reconnect = ...
```

After: the same names and kinds, identical set:
```
export { readLastRead } from './last-read';
export { suspendStore, wakeCore } from './suspend';
export { flushOnline } from './online';
export { onAuthFailed, type SessionCheck } from './session-check';
export { CONNECT_RETRY_DELAYS_MS } from './connect';
export interface LifecycleBoot { ... }
export interface LifecycleCtx extends HistoryCtx, DraftTurns { ... }
export const startStore = ...
export const retryBoot = ...
export const stopStore = ...
export function reset ...
export const reconnect = ...
```
`connectXmpp` was module-private before and is still not re-exported from
`lifecycle.ts`/`store/index.ts`, so the public barrel is unchanged. No importer
was edited.

### Checks run

- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/lifecycle.test.ts`
  — 1 file, 13 passed. (The logged `createXmpp is not provided in this test`
  line is the suite's intended failure-path case.)
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/realStore.lifecycle.test.tsx`
  — 1 file, 3 passed.
- `pnpm gate` (repo root), summary:
```
gate: 3 changed file(s) against main
PASS  install (frozen)  (2.0s)
PASS  format  (1.1s)
PASS  lint  (1.4s)
PASS  typecheck  (4.9s)
PASS  effect  (2.0s)
PASS  tests @zilar/client-core  (10.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- No `// effect-plain:` marker: `connect.ts` makes a value import from `effect`,
  so the ratchet classifies it `effect` (the gate `effect` step passed).
- No behaviour change and no test edits; the line count is down on
  `lifecycle.ts` because `size: every changed source file is within 400 lines`
  is measured on changed files only.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, with one nit (the header comment still lists the connect block).
- **What the lead checked:**
  - `lifecycle.ts` drops from 400 to 240 lines, and `connect.ts` is 177;
  - the `^export` lines differ from main only in that `CONNECT_RETRY_DELAYS_MS` is now re-exported from `./connect`;
  - `connect.ts` imports only the **type** `LifecycleCtx` from `./lifecycle`, so there is no runtime cycle.
- **Tests:** the client-core and web realStore tests passed in the worker's gate. Boot, connect and reconnect behaviour is unchanged.
