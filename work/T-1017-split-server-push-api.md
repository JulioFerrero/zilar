---
id: T-1017
title: "Size split T89: apps/server/src/push/api.ts (484 lines) into push/{api-handlers,api-subscribe,api-util}.ts, api.ts keeps deps, group and mount"
status: merged
milestone: M5
branch: task/T-1017-split-server-push-api
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1017: Split `push/api.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/push/api.ts` is 484 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #85 (task T89): `push/api-handlers.ts`, `push/api-subscribe.ts`, `push/api-util.ts`, under `apps/server/src/`. `push/api.ts` keeps the deps, the group declaration, the layer, the mount and every export it has today.

Move the code unchanged, and skip all three Dedup items:
- `isUniqueViolation` and `errorName` cross files;
- the room-sync helper would merge three code paths, which is a separate task.

The subscribe handler stores the device's push keys, so not one line of its logic changes.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #85, and `apps/server/src/push/api.ts`.

### Allowed files
`apps/server/src/push/api.ts`, `apps/server/src/push/api-handlers.ts`, `apps/server/src/push/api-subscribe.ts`, `apps/server/src/push/api-util.ts`, `work/T-1017-split-server-push-api.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/server/src/push/api.ts` (484 lines) per `docs/audit/split-rules.md` and
`docs/audit/size-plan.md` §2.2 #85:

- `push/api-util.ts` — `STRICT_DECODE`, `isUniqueViolation`, `errorName`, and the
  `requirePush` body wrapped in `createRequirePush(deps)`.
- `push/api-subscribe.ts` — the subscribe handler, exported as
  `createSubscribeHandler(deps, subscribeLimiter, requirePush)`.
- `push/api-handlers.ts` — `createPushGroupLayer(api, deps, limiters)` holding the
  config, list, remove, settings, updateSettings and test handlers and chaining the
  subscribe handler from `./api-subscribe`.
- `push/api.ts` — barrel: deps interfaces, rate-limit constants, `PushApi` group,
  `createPushApi` (still builds the three limiters once, then layer + mount), and the
  same exports as before.

Logic is moved unchanged. `requirePush` is the only wrapper: a nested closure became
`createRequirePush(deps)` so both new handler files can share it; its body is
byte-identical and call sites stay `requirePush()`.

All three Dedup items were skipped as instructed: `isUniqueViolation` / `errorName`
were *not* sent to `handles/store.ts` (§2.7, cross-file), and the three room-sync
blocks were *not* merged.

### Commands and results

- `pnpm install` — done.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/candidates.test.ts`
  — 5 passed (1 file). This is the nearest test file the gate selects for this dir.
- `pnpm gate` (from the repo root):

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (2.2s)
PASS  format  (0.9s)
PASS  lint  (1.6s)
PASS  typecheck  (5.0s)
PASS  effect  (0.8s)
PASS  tests @zilar/server  (7.6s)
scope: every changed file is inside the Allowed files
GATE PASS
```

No `effect-plain` marker was needed (the `effect` ratchet step passed).

### `wc -l` (old vs new)

- old `apps/server/src/push/api.ts`: 484
- new `push/api.ts`: 103
- new `push/api-handlers.ts`: 229
- new `push/api-subscribe.ts`: 143
- new `push/api-util.ts`: 60

Every file is under 400 lines.

### Export list (before vs after)

`grep -E "^export"` on the old `api.ts` equals `grep -E "^export"` on the new barrel
`api.ts`, name for name, no additions and no removals:

```
export const PUSH_SUBSCRIBE_RATE_LIMIT_MAX
export const PUSH_SUBSCRIBE_RATE_LIMIT_WINDOW_MS
export const PUSH_SETTINGS_RATE_LIMIT_MAX
export const PUSH_SETTINGS_RATE_LIMIT_WINDOW_MS
export const PUSH_TEST_RATE_LIMIT_MAX
export const PUSH_TEST_RATE_LIMIT_WINDOW_MS
export interface PushRoutesDependencies
export interface PushApiDependencies
export function createPushApi
```

New (internal) exports added by the split files, none of them previously exported
from `api.ts`:

```
push/api-handlers.ts: export function createPushGroupLayer
push/api-subscribe.ts: export function createSubscribeHandler
push/api-util.ts: export const STRICT_DECODE
push/api-util.ts: export function isUniqueViolation
push/api-util.ts: export function errorName
push/api-util.ts: export function createRequirePush
```

The only importer, `apps/server/src/app.ts` (`import { createPushApi } from './push/api'`),
is unchanged.

### Deviations / decisions

- The plan's `api-util.ts` note highlights `requirePush` + `STRICT_DECODE` (lines
  84–157). I also placed the two skipped dedup helpers `isUniqueViolation` and
  `errorName` there, because `errorName` is used by both `api-handlers` (remove) and
  `api-subscribe` (subscribe), so it needs one shared home; leaving them in `api.ts`
  would have forced new exports there.
- The rate-limit constants stay in `api.ts` (their current home, part of the barrel)
  and `createPushApi` still builds the three limiters, passing them into
  `createPushGroupLayer` as `{ subscribe, settings, test }`. This keeps the plan's
  "api.ts keeps deps, group decl, layer + mount" and avoids an `api.ts` ↔
  `api-handlers` value import cycle (the plan does not assign the constants to a new
  file).
- Types are imported from `./api` only as `import type` in the new files, so there is
  no runtime cycle.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `push/api.ts` (484 lines) keeps the deps, the group and the mount, plus `api-handlers` (229), `api-subscribe` (143) and `api-util`. The code moved unchanged, including the subscribe handler's key storage.
- **Check:** the gate passed.
