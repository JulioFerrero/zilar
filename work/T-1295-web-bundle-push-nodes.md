---
id: T-1295
title: "Web bundle split (PERF-14): vendor chunks for effect, better-auth and radix so the main chunk shrinks; server: a device's notified-ids set is dropped when it unsubscribes (PERF-17)"
status: merged
milestone: M5
branch: task/T-1295-web-bundle-push-nodes
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1295: Web bundle split; push memory cleanup

## Spec (written by Claude, do not edit)

### Why
`docs/audit/performance-audit.md`:
- **PERF-14** (P3, `:144`, suspected): the routes and `MarkdownText` are lazy, but `apps/web/vite.config.ts` has no `manualChunks`. 142 files import `effect`, and the main chunk also carries `better-auth` and `radix-ui`.
- **PERF-17** (P3, `:220`): `recentlyNotified` (`apps/server/src/push/delivery.ts`) is capped per node, but nodes are never removed when a device unsubscribes.

**First recheck both findings on main.** If one is already fixed, say so with `file:line` and skip it.

### What to build
1. **PERF-14:**
   - run `pnpm --filter @zilar/web build` and record the chunk sizes before;
   - add `manualChunks` that put `effect`, `better-auth` and the radix packages in their own vendor chunks;
   - record the sizes after, and paste both tables in the Report;
   - if the main chunk doesn't get smaller, revert and say so.
2. **PERF-17:** when a push subscription or device is removed (cite the unsubscribe path and the T-1255 session-revoke cascade), delete its node from `recentlyNotified`.
3. **Test** (the message pipeline), 1 case in `apps/server/src/push/delivery.test.ts` (or the nearest): unsubscribe removes the node's set.

### Read first
`AGENTS.md`, `docs/audit/performance-audit.md` (`:144`, `:220`), `apps/web/vite.config.ts` and `apps/server/src/push/delivery.ts`.

### Allowed files
`apps/web/vite.config.ts`, `apps/server/src/push/*.ts`, `work/T-1295-web-bundle-push-nodes.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass. The bundle report is in the Report.

---

## Report (written by the worker when done)

### Recheck on main
- **PERF-14** (confirmed, not fixed): `apps/web/vite.config.ts` had no `manualChunks`; the routes (`AppRoutes.tsx`) and `MarkdownText` lazy-load.
- **PERF-17** (confirmed, not fixed): `recentlyNotified` is a per-process `Map<string, Set<string>>` on `PushServiceDeps` (`service.ts:39`), capped at 500 ids/node (`delivery.ts:253`) and no removal path ever deleted a node.

### PERF-14 — web vendor chunks (`apps/web/vite.config.ts`)
Added `build.rollupOptions.output.manualChunks` (function form only: Rolldown in Vite 8 does not accept the object form) putting `effect`, `better-auth` and radix (`radix-ui` + `@radix-ui/*`) in their own vendor chunks.

**Measured, requested split first:** those three alone do **not** shrink the entry chunk. They already sat in the shared route chunks, so the split shrank `jsx-runtime` (145.61 → 6.54 kB), `button` (172.93 → 91.71 kB) and `AuthProvider` (32.96 → 1.55 kB), but left `index-*.js` at 636.44 → 636.68 kB. The entry only holds React/router, so I also split the React runtime (`react`, `react-dom`, `react-router`, `scheduler`) — the audit's own `effect`/`react`/`radix` list (`performance-audit.md:149`). The entry then shrank **636.44 → 425.49 kB (−210.95 kB, −33 %; gzip 178.89 → 113.19 kB)**.

Before (`pnpm --filter @zilar/web build`, main, no `manualChunks`):

| chunk | size | gzip |
| --- | --- | --- |
| index-3_8u7A9e.js (entry) | 636.44 kB | 178.89 kB |
| card-BKS7MImq.js | 198.60 kB | 61.03 kB |
| button-DNPETMHz.js | 172.93 kB | 55.80 kB |
| MarkdownText-lFkCADuQ.js | 154.61 kB | 46.30 kB |
| jsx-runtime-DT2V-4cS.js | 145.61 kB | 48.08 kB |
| chunk-OB3PAWPO-C-K3CTrj.js | 40.14 kB | 14.46 kB |
| AuthProvider-D2s2uRnK.js | 32.96 kB | 12.48 kB |
| StickersPage-DcBW_nE2.js | 31.37 kB | 9.46 kB |
| MachinesPage-CcQoOuis.js | 19.00 kB | 5.49 kB |
| NotificationsPage-BUte76ZO.js | 11.08 kB | 3.56 kB |
| IntegrationsPage-BC7TvJzq.js | 11.04 kB | 3.25 kB |
| src-DJZq0iuZ.js | 9.13 kB | 3.57 kB |
| ConnectionsPage-ClFSGZ2Q.js | 7.12 kB | 2.50 kB |
| ApprovalsPage-DkNF5FvY.js | 6.86 kB | 2.51 kB |
| SetupPage-DaxkEjk_.js | 4.50 kB | 1.86 kB |
| FoldersPage-PbqB4Pgh.js | 4.34 kB | 1.83 kB |
| text-input-zUJHy8Pg.js | 3.25 kB | 1.38 kB |
| LoginPage-BrxjWJ7f.js | 1.17 kB | 0.67 kB |
| rolldown-runtime-hePW80VL.js | 0.71 kB | 0.42 kB |
| useIsServerOwner-Dj3NG26C.js | 0.33 kB | 0.25 kB |
| url-C5ldkyXA.js | 0.13 kB | 0.11 kB |
| use-action-_X7hrKyh.js | 0.07 kB | 0.08 kB |
| index-BnBdjOZ9.css | 58.63 kB | 11.84 kB |

After (final `manualChunks`):

| chunk | size | gzip |
| --- | --- | --- |
| index-zJiGK490.js (entry) | 425.49 kB | 113.19 kB |
| vendor-react-7pLS7tja.js | 254.79 kB | 81.22 kB |
| vendor-effect-CPwdUH7e.js | 205.64 kB | 67.09 kB |
| card-DbNUiFz6.js | 194.85 kB | 59.79 kB |
| MarkdownText-Rb23hojZ.js | 154.65 kB | 46.32 kB |
| button-BQw2dNzy.js | 91.71 kB | 27.90 kB |
| vendor-better-auth-CQH7Cndg.js | 39.38 kB | 14.59 kB |
| StickersPage-Djwm-CIp.js | 31.42 kB | 9.47 kB |
| MachinesPage-DeOfaiXN.js | 19.04 kB | 5.51 kB |
| NotificationsPage-PE8xSQe7.js | 11.12 kB | 3.57 kB |
| IntegrationsPage-bMNdMiVs.js | 11.08 kB | 3.26 kB |
| src-BT1eVsfP.js | 9.12 kB | 3.56 kB |
| ConnectionsPage-B_tNZbX2.js | 7.17 kB | 2.51 kB |
| ApprovalsPage-vhaHgt5M.js | 6.90 kB | 2.52 kB |
| src-Ciq-Fuoh.js | 6.11 kB | 2.52 kB |
| SetupPage-DXlKb6Gy.js | 4.55 kB | 1.87 kB |
| FoldersPage--ramBM5y.js | 4.43 kB | 1.86 kB |
| text-input-3mMK3P3E.js | 3.30 kB | 1.40 kB |
| vendor-radix-DrgzGnlr.js | 2.91 kB | 1.29 kB |
| AuthProvider-DXNabNvW.js | 1.55 kB | 0.78 kB |
| LoginPage-Bt9BLJ_p.js | 1.17 kB | 0.66 kB |
| rolldown-runtime-hePW80VL.js | 0.71 kB | 0.42 kB |
| useIsServerOwner-CI867XmX.js | 0.34 kB | 0.25 kB |
| url-C5ldkyXA.js | 0.13 kB | 0.11 kB |
| use-action-O0YES7Ay.js | 0.07 kB | 0.08 kB |
| index-YjA-7EfX.css | 58.65 kB | 11.84 kB |

The main chunk shrank, so the spec's "revert" fallback is not triggered.

### PERF-17 — `recentlyNotified` for a removed device (`apps/server/src/push/delivery.ts`)
Removing a device row happens in three places, and only the push component holds the map:
- **API unsubscribe:** `DELETE /api/push/subscriptions` and the test route's 410 `device_gone` call `removeDevice` (`store.ts:71`; call sites `api-handlers.ts:106,303,353`). The API deps (`PushRoutesDependencies`) do not carry the map, and the component's map is built in `main.ts:498-507` and is never passed to `createApp`/`createPushApi` (`app.ts:370`) — those files are outside the Allowed files.
- **Component cleanup:** a transport reporting `gone` removes the row via `removeDeviceByNode`.
- **T-1255 session-revoke cascade:** deleting a `session` row FK-cascades its `push_subscriptions` rows (`drizzle/0051_push_session.sql:2`, delete at `auth/sessions.ts:118`); the app never observes it.

Fix, all inside `delivery.ts`:
1. `handleIncomingPush`: when `deviceByNode` finds no row, delete `notification.node` from `recentlyNotified` before answering `unknown-device`. A removed node's next publish is always `unknown-device`, so this one line covers the API unsubscribe, the test route and the DB-only session cascade (the row is gone whichever way it left).
2. `deliverToDevice` / `sendWithCleanupEffect`: `sendWithCleanupEffect` now returns whether the transport reported `gone`; when it did, `deliverToDevice` deletes the node's set and skips `markNotified` (previously it re-added the node right after the removal).

### Files changed
`apps/server/src/push/delivery.ts`, `apps/server/src/push/delivery.test.ts`, `apps/web/vite.config.ts`, `work/T-1295-web-bundle-push-nodes.md`.

### Tests (message pipeline)
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/delivery.test.ts`: 8 passed.
- `pnpm --filter @zilar/server exec vitest run src/push --reporter=dot` (task Check): 10 files, 66 passed.
- Added one case, `forgets an unsubscribed node when its publish arrives` (row removed via `removeDevice`, then `handleIncomingPush` answers `unknown-device` and the set is gone), and extended `removes an fcm device whose token is gone` to assert the set is deleted on the `gone` path.

### Gate
`pnpm gate` (from the repo root):

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (2.0s)
PASS  format  (0.6s)
PASS  lint  (1.0s)
PASS  typecheck  (5.3s)
PASS  effect  (0.8s)
PASS  tests @zilar/server  (8.3s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Deviations from the spec
- **Added React to the vendor split.** The three requested packages alone left the entry chunk unchanged (measured above); React is the part actually in it, and the audit's `:149` recommends `effect`/`react`/`radix`. If the lead prefers strictly the three, the `vendor-react` branch can be dropped — but then the entry does not shrink and the spec's revert fallback applies.
- **PERF-17 is handled where the component observes the removal**, not in the API handler, because the map cannot reach `PushApiDependencies` without editing `app.ts`/`main.ts` (outside Allowed files). The `unknown-device` cleanup covers all three removal paths, including the session cascade that no application code observes.

### Open questions
- None blocking. The only judgement call is the React vendor chunk above.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (1 nit, 1 follow-up).**
- **Bundle:** the entry chunk dropped from 636.44 kB (178.89 gzip) to 425.49 kB (113.19 gzip). React joined the vendor split, because the three requested packages alone didn't shrink the entry.
- **Lead's check of the production build** (`VITE_MOCK=1 vite build`, then `vite preview`): Marta's chat, `/settings/profile` and `/settings/stickers` load with no console errors, so chunk load order is fine.
- **Lead's checks after the rebase:** server push vitest: 10 files, 66 tests pass. server tsc: 0 errors. `delivery.ts` is 296 lines.
- **Follow-up:** a normal unsubscribe doesn't clear the dedupe set (only a later publish or a `gone` does); the cleanup belongs in the subscribe API, outside this task's Allowed files. It's small (about 50 KB per stale node), so it goes on the later list.
