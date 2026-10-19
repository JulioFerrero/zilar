---
id: T-2138
title: "Server (link-preview to web-tools): fold single-use files back into their only importer where the split was for size or is one concept — fewer imports, exports and repeated types; no behaviour change"
status: merged
milestone: M5
branch: task/T-2138-server-folds-b
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2138: Fold single-use server files (link-preview to web-tools)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the code map total must go down. 400 lines is a soft limit, and files an earlier task split only for size may be merged back when that saves lines. Only a file over 800 lines must split. Each fold below removes the import and export lines, and any type or helper the two files both declare.

The lead listed these at `e4a868766`. Each mover has exactly one production importer, the host; the tests listed import it too.

| Mover (lines) | Host (lines) | Tests that import the mover |
| --- | --- | --- |
| `link-preview/parse.ts` (130) | `link-preview/fetch.ts` (296) | link-preview/link-preview.test.ts markup/scan.test.ts |
| `machines/pairing.ts` (178) | `machines/service.ts` (102) | — |
| `push/api-subscribe.ts` (165) | `push/api-handlers.ts` (342) | — |
| `push/api-test.ts` (167) | `push/api-handlers.ts` (342) | — |
| `push/fcm-token.ts` (139) | `push/native-sender.ts` (29) | push/fcm-token.test.ts push/fcm.test.ts |
| `push/store-save.ts` (216) | `push/store.ts` (204) | — |
| `routines/alert-link.ts` (83) | `message-blocks/respond.ts` (405) | message-blocks/respond.test.ts |
| `sandbox/tool-worker-fetch.ts` (208) | `sandbox/tool-worker.ts` (377) | — |
| `sandbox/tool-worker-vm.ts` (143) | `sandbox/tool-worker.ts` (377) | — |
| `startup.ts` (151) | `startup/boot.ts` (132) | — |
| `stickers/favorites.ts` (133) | `stickers/api-handlers.ts` (407) | — |
| `stickers/panel.ts` (136) | `stickers/api-handlers.ts` (407) | — |
| `stickers/telegram/transport.ts` (262) | `stickers/telegram/client.ts` (100) | — |
| `tools/wire.ts` (169) | `tools/routes.ts` (367) | — |
| `topics/ais.ts` (193) | `topics/service.ts` (182) | actions/unattended.test.ts topics/ais.test.ts |
| `topics/room-push.ts` (206) | `topics/rooms.ts` (112) | — |
| `web-tools/guarded-fetch-pinned.ts` (132) | `web-tools/guarded-fetch.ts` (233) | — |
| `web-tools/prices.ts` (175) | `web-tools/price-adapter.ts` (125) | web-tools/adapters.test.ts |

All paths are under `apps/server/src/`.

### Steps
For each row, read both files.
1. **Fold** when the mover is a slice of the host's concept (a handler, a parser, a schema or a query helper that only the host uses) or was split out for size:
   - move its code into the host;
   - delete the mover;
   - remove the now-internal `export`s the host no longer needs;
   - drop declarations that become duplicates.
2. **Chains.** Fold in order. For example, `actions/approval-path.ts` goes into `actions/decisions.ts`, which then goes into `actions/gateway.ts`, only if the result stays within the cap.
3. **Cap.** No host may end above 650 lines; skip a fold that would push it over. Several movers into one host count together.
4. **Skip** a fold when the mover is a separate concept a reader looks for by name, or a worker-thread or process entry loaded by path. Check for `new Worker(`, `import.meta.url` or a file-path string that names the mover before folding it.
5. **Tests.** Update the import path, or the `vi.mock(...)` path, in each listed test; change nothing else in it. No new tests.

### Rules
- No behaviour change: the same SQL, routes, limits, log fields and error strings.
- The diff only moves code, removes import/export lines and removes duplicates. It changes no line of logic.
- Do not touch `apps/server/src/agents/**` or `apps/server/src/auth/**`.
- Product lines go down by at least 60.

### Allowed files
- `apps/server/src/actions/unattended.test.ts`
- `apps/server/src/link-preview/fetch.ts`
- `apps/server/src/link-preview/link-preview.test.ts`
- `apps/server/src/link-preview/parse.ts`
- `apps/server/src/machines/pairing.ts`
- `apps/server/src/machines/service.ts`
- `apps/server/src/markup/scan.test.ts`
- `apps/server/src/message-blocks/respond.test.ts`
- `apps/server/src/message-blocks/respond.ts`
- `apps/server/src/push/api-handlers.ts`
- `apps/server/src/push/api-subscribe.ts`
- `apps/server/src/push/api-test.ts`
- `apps/server/src/push/fcm-token.test.ts`
- `apps/server/src/push/fcm-token.ts`
- `apps/server/src/push/fcm.test.ts`
- `apps/server/src/push/native-sender.ts`
- `apps/server/src/push/store-save.ts`
- `apps/server/src/push/store.ts`
- `apps/server/src/routines/alert-link.ts`
- `apps/server/src/sandbox/tool-worker-fetch.ts`
- `apps/server/src/sandbox/tool-worker-vm.ts`
- `apps/server/src/sandbox/tool-worker.ts`
- `apps/server/src/startup.ts`
- `apps/server/src/startup/boot.ts`
- `apps/server/src/stickers/api-handlers.ts`
- `apps/server/src/stickers/favorites.ts`
- `apps/server/src/stickers/panel.ts`
- `apps/server/src/stickers/telegram/client.ts`
- `apps/server/src/stickers/telegram/transport.ts`
- `apps/server/src/tools/routes.ts`
- `apps/server/src/tools/wire.ts`
- `apps/server/src/topics/ais.test.ts`
- `apps/server/src/topics/ais.ts`
- `apps/server/src/topics/room-push.ts`
- `apps/server/src/topics/rooms.ts`
- `apps/server/src/topics/service.ts`
- `apps/server/src/web-tools/adapters.test.ts`
- `apps/server/src/web-tools/guarded-fetch-pinned.ts`
- `apps/server/src/web-tools/guarded-fetch.ts`
- `apps/server/src/web-tools/price-adapter.ts`
- `apps/server/src/web-tools/prices.ts`
- `work/T-2138-server-folds-b.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, including the server tests it runs.
- Product lines go down by at least 60.
- The Report lists each row: folded (lines saved) or skipped (why).

---

## Report (written by the worker when done)

### What I did

Folded 13 single-use server modules into their host and deleted them; skipped 5 rows for the reasons below. Product (non-test) lines under `apps/server/src` are down by **121** (`git diff HEAD --numstat`: 2151 added, 2272 deleted).

| Row | Result |
| --- | --- |
| `link-preview/parse.ts` → `link-preview/fetch.ts` | folded, -1 line (425 lines) |
| `machines/pairing.ts` → `machines/service.ts` | folded, -14 (266) |
| `push/api-subscribe.ts` → `push/api-handlers.ts` | folded, -5 (502) |
| `push/api-test.ts` → `push/api-handlers.ts` | **skipped**: with both movers the host reaches 656 lines, over the 650 cap |
| `push/fcm-token.ts` → `push/native-sender.ts` | **skipped**: `push/fcm.ts` (not in Allowed files) also imports `FcmFetch` and `FcmTokenProvider`, so the mover has a second production importer |
| `push/store-save.ts` → `push/store.ts` | folded, -23 (397) |
| `routines/alert-link.ts` → `message-blocks/respond.ts` | folded, -7 (481) |
| `sandbox/tool-worker-fetch.ts` → `sandbox/tool-worker.ts` | **skipped**: `sandbox/run-tool.ts` loads `tool-worker.ts` by path with `new Worker(...)`; rule 4 |
| `sandbox/tool-worker-vm.ts` → `sandbox/tool-worker.ts` | **skipped**: same worker-entry reason; both would also exceed the cap (377 + 208 + 143) |
| `startup.ts` → `startup/boot.ts` | folded, -9 (274) |
| `stickers/favorites.ts` → `stickers/api-handlers.ts` | folded, -6 (534) |
| `stickers/panel.ts` → `stickers/api-handlers.ts` | **skipped**: with both movers the host reaches about 665 lines, over the 650 cap |
| `stickers/telegram/transport.ts` → `stickers/telegram/client.ts` | folded, -6 (351) |
| `tools/wire.ts` → `tools/routes.ts` | folded, -18 (518) |
| `topics/ais.ts` → `topics/service.ts` | folded, +4 (379); the host gained the movers' cross-module imports, so this row adds lines while removing a file |
| `topics/room-push.ts` → `topics/rooms.ts` | folded, -15 (303) |
| `web-tools/guarded-fetch-pinned.ts` → `web-tools/guarded-fetch.ts` | folded, -8 (357) |
| `web-tools/prices.ts` → `web-tools/price-adapter.ts` | folded, -13 (287) |

Tests: only the import paths in `link-preview/link-preview.test.ts`, `markup/scan.test.ts`, `message-blocks/respond.test.ts`, `topics/ais.test.ts`, `actions/unattended.test.ts` and `web-tools/adapters.test.ts` changed. No logic, SQL, route, limit, log field or error string changed.

One dead pair of declarations (`NativePushTokenSchema` / `NativePushToken`) was left behind by the `store-save` fold with no reader and tripped `no-unused-vars`; I removed it (no behaviour).

### Checks run

- `pnpm install`: passed (peer-dependency warnings only).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot` on link-preview, scan, api-subscribe, api-preview, store, respond, ais and web-tools adapters: first run had 4 failures (`parseLinkPreview is not a function`, since the tests import it directly); I re-exported it from `fetch.ts` and reran the link-preview/scan pair: **28 passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot` on 12 sticker/topic/tools/web-tools test files: **67 passed**.
- `pnpm gate`: `GATE PASS`.

```
gate: 33 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (1.5s)
PASS  lint  (0.9s)
PASS  typecheck  (3.7s)
PASS  effect  (0.9s)
PASS  build @zilar/server  (0.4s)
PASS  tests @zilar/server  (47.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

### Notes for the lead

- The cap and the second-importer rule decided three skips; folding the remaining `api-test`/`panel` rows would need either a larger cap or splitting the host again, which the spec forbids.
- `push/fcm-token.ts` needs `apps/server/src/push/fcm.ts` in Allowed files before it can move into `native-sender.ts`; the two type imports could then move too.
- `topics/ais.ts` is the one fold that adds net lines (+4), because its imports are now duplicated in `topics/service.ts`; the file count still drops. If the goal is strictly fewer lines, that row could be reverted independently.
- Soft size warnings are expected for the folded hosts (largest 534 lines); none is over 800.

## Review (written by Claude)

Approved; the pre-review was clean (1 nit: Report arithmetic). Net −110: 13 single-use server files folded into their only importer (link-preview parse, machines pairing, push subscribe and store-save, alert-link, startup, sticker favorites, the telegram transport, tools wire, topic AIs, room push, the pinned guarded fetch, prices).

**Skips:** 5 rows were skipped for sound reasons:
- the `sandbox/` workers load `tool-worker.ts` by path with `new Worker(...)`;
- `fcm.ts` is a second importer of `fcm-token.ts`;
- two hosts would pass the 650-line cap.

**Lead fix round:** two "why" comments the fold dropped are back, the device-save rule in `push/store.ts` and the pinned-fetch SNI/Host rule in `web-tools/guarded-fetch.ts`. The gate ran the server suite. Live route probe after the push.
