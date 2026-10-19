---
id: T-2208
title: "Store phase 3 T6: one debounced message-cache writer and one snapshot builder in client-core; the web's timer and the phone's file queue use them; no behaviour change"
status: merged
milestone: M5
branch: task/T-2208-cache-writer
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2208: One message-cache writer (store phase 3, T6)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/store-phase3-plan.md` step T6. Julio said go on 2026-10-19. Both apps cache the newest chats' messages for a cold start. Each writes its own debounce and its own snapshot selection. Only the storage differs: `localStorage` on web, a file on the phone.

### Facts (the lead read these on 2026-10-19)
1. **The phone writer.** `apps/mobile/src/store/offline-cache.ts:72-130` `createOfflineCache(port)` is a full writer:
   - `schedule` debounces 2 s;
   - `flush` writes at once;
   - writes run on an ordered `ops` chain;
   - `clear()` sets a fence, so no scheduled or late write recreates the file until the next `hydrate`;
   - the port is `{ read, write, remove }` (`:23-27`).
2. **The web debounce.** It is hand-rolled in `apps/web/src/store/effects/lifecycle.ts:117-150`: a `WeakMap` of timers, `cancelScheduledMessageSave`, `saveMessages` and `scheduleMessageSave`. Sign-out cancels it at `:54`. `realStore.ts:41` calls `scheduleMessageSave`.
3. **The snapshot, built twice:**
   - web `writeMessageCache` (`apps/web/src/store/messageCache.ts:56-78`): `selectCachedChats(chats, null, 30)`, the messages of those chats, all `pinsByChat`, 1.5 MB cap, `blob:`/`data:` stripped;
   - phone `offlineSnapshot` (`apps/mobile/src/store/offline-cache.ts:47-70`): `selectCachedChats(chats, activeChatId, 50)`, their messages, the pins of those chats, `file://`/`data:` stripped.
4. Both encode with the core `encodeMessageCache` and decode with `decodeMessageCache` (`packages/client-core/src/store/message-cache.ts`). The web also drops another account's copy on read (`messageCache.ts:20-34`).

### Steps
1. In `packages/client-core/src/store/message-cache.ts`, add:
   - `createMessageCacheWriter(port, { delayMs, encode })`: the phone writer from fact 1, moved as is (port `{ read, write, remove }`, Promise-based);
   - `buildCacheSnapshot({ userId, chats, messagesByChat, activeChatId, maxChats, pinsFor })`: the shared selection from fact 3. Each app passes its own limits and its own pins source.
2. Phone: `offline-cache.ts` keeps its constants, its file port and `readSessionUserId`, and uses the core writer and builder. `offline-cache-sync.ts` keeps only the store watch.
3. Web: `messageCache.ts` keeps its constants, the read helpers and a `localStorage` port (a sync wrapper resolving promises). `lifecycle.ts` drops its timer map and uses one writer per store:
   - `scheduleMessageSave` becomes `schedule`, `saveMessages` becomes `flush`;
   - sign-out calls `clear()`, so a late write can no longer recreate the key (today the cancel does that).
   - Keep the `pagehide` flush and the `typeof window === 'undefined'` guard.
4. Keep every limit, prefix, key name, file name and delay exactly as now. No re-export shims.
5. Tests: the existing cache tests (`packages/client-core/src/store/message-cache.test.ts`, `apps/web/src/store/messageCache.test.ts`, `apps/mobile/src/store/offline-cache.test.ts`) may change only their imports and call names; no case is removed.
6. **Stop rule:** measure the net over every changed file, test files excluded. If it is not at least −30, do not commit. Set `status: blocked` and write the numbers in the Report.

### Allowed files
- `packages/client-core/src/store/message-cache.ts`
- `packages/client-core/src/store/index.ts`
- `apps/web/src/store/messageCache.ts`
- `apps/web/src/store/effects/lifecycle.ts`
- `apps/web/src/store/effects/ports.ts`
- `apps/web/src/store/realStore.ts`
- `apps/mobile/src/store/offline-cache.ts`
- `apps/mobile/src/store/offline-cache-sync.ts`
- `apps/mobile/src/store/effects/lifecycle.ts`
- `packages/client-core/src/store/message-cache.test.ts`
- `apps/web/src/store/messageCache.test.ts`
- `apps/mobile/src/store/offline-cache.test.ts`
- `work/T-2208-cache-writer.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/message-cache.test.ts --reporter=dot
pnpm --filter @zilar/web exec vitest run src/store --reporter=dot
pnpm --filter @zilar/mobile exec vitest run src/store --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes, and the cache tests keep every case.
- Net at least −30 (test files excluded).
- The lead checks:
  - web mock: send a text, reload, and the chat paints from the cache before the network;
  - phone emulator: kill the app and relaunch it, and the last chat paints at once;
  - after sign-out on web, no `zilar:messages` key stays in `localStorage`.

---

## Report (written by the worker when done)

### What I did

- `packages/client-core/src/store/message-cache.ts`: added `buildCacheSnapshot({ userId, chats, messagesByChat, activeChatId, maxChats, pinsFor })` and `createMessageCacheWriter(port, { delayMs, encode })`. The writer is the phone writer moved unchanged: 2 s debounce, immediate `flush`, ordered `ops` chain, and the `clear()` fence that only `hydrate()` reopens.
- Phone: `offline-cache.ts` keeps its limit/prefix/delay constants, the file port and `readSessionUserId`; the port is now the generic `fileCachePort(fileName)` used by both the message file and the chat-list file. `offline-cache-sync.ts` creates the core writer and calls the core builder inside its store watch. `effects/lifecycle.ts` uses the shared file port, so its three duplicated `expo-file-system` helpers are gone.
- Web: `messageCache.ts` keeps the constants, the read helpers (including the foreign-owner drop) and adds the `localStorage` port plus `createWebMessageCache`. `effects/lifecycle.ts` drops the timer map; `scheduleMessageSave`/`saveMessages` are now `scheduleMessageCache`/`flushMessageCache`, one writer per store. Sign-out goes through the writer's `clear()`, and `pagehide` still flushes immediately; `typeof window === 'undefined'` is still guarded.
- `buildCacheSnapshot` carries the phone cache's privacy note: display data only, no token and no media bytes.
- Limits and names are unchanged: web 30 chats / 1.5 MB / `zilar:messages` / 2 s and `blob:`/`data:`; phone 50 chats / 50 rows / `zilar-offline-cache.json` / 2 s and `file://`/`data:`.
- Tests changed only imports/call names (web now drives the writer's port, mobile configures the core writer); every existing case is kept.

### Files changed

- `packages/client-core/src/store/message-cache.ts`
- `apps/web/src/store/messageCache.ts`
- `apps/web/src/store/effects/lifecycle.ts`
- `apps/web/src/store/realStore.ts`
- `apps/mobile/src/store/offline-cache.ts`
- `apps/mobile/src/store/offline-cache-sync.ts`
- `apps/mobile/src/store/effects/lifecycle.ts`
- `apps/web/src/store/messageCache.test.ts`
- `apps/mobile/src/store/offline-cache.test.ts`
- `work/T-2208-cache-writer.md`

### Commands and results

- `pnpm install`: done in 13.3 s; one pre-existing peer warning (`@types/react-dom` wants `@types/react ^19.3.0`, found 19.2.18).
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/message-cache.test.ts`: 1 file, 9 tests passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/messageCache.test.ts`: 1 file, 1 test passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/offline-cache.test.ts`: 1 file, 4 tests passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/effects/switchUser.test.ts`: 1 file, 1 test passed (reset/sign-out path).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/real-store.lifecycle.test.ts`: 1 file, 11 tests passed.
- `pnpm --filter @zilar/web exec vitest run src/store --maxWorkers=2 --reporter=dot`: 9 files, 18 tests passed.
- `pnpm --filter @zilar/mobile exec vitest run src/store --maxWorkers=2 --reporter=dot`: 10 files, 44 tests passed.
- `pnpm gate`: after the follow-up rename and doc-comment fix, PASS for install (frozen), format, lint, typecheck, effect, build @zilar/server, tests @zilar/client-core (4.7 s), tests @zilar/mobile (9.4 s), tests @zilar/web (8.9 s). `scope: every changed file is inside the Allowed files`; `GATE PASS`.

Gate summary lines:

```text
PASS  install (frozen)  (1.5s)
PASS  format  (1.6s)
PASS  lint  (1.0s)
PASS  typecheck  (4.9s)
PASS  effect  (1.1s)
PASS  build @zilar/server  (0.8s)
PASS  tests @zilar/client-core  (4.7s)
PASS  tests @zilar/mobile  (9.4s)
PASS  tests @zilar/web  (8.9s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Net size (test files and this task file excluded)

`git diff --numstat` per changed source file:

| File | Net |
| --- | ---: |
| `packages/client-core/src/store/message-cache.ts` | +95 |
| `apps/web/src/store/messageCache.ts` | +12 |
| `apps/web/src/store/effects/lifecycle.ts` | +6 |
| `apps/web/src/store/realStore.ts` | 0 |
| `apps/mobile/src/store/offline-cache.ts` | −115 |
| `apps/mobile/src/store/offline-cache-sync.ts` | +9 |
| `apps/mobile/src/store/effects/lifecycle.ts` | −38 |
| **Total** | **−31** |

### Deviations / notes

- I also touched `apps/mobile/src/store/effects/lifecycle.ts`, which is in the allowed list and named by the T6 plan. It now uses the shared `fileCachePort`, which removed the duplicated `expo-file-system` read/write/delete helpers.
- `messageCache.ts` exports `MAX_CACHED_CHATS` so `lifecycle.ts` can call the core builder directly; no app-specific snapshot wrapper was kept.
- `OfflineCachePort` remains as an app-side type alias to the core port, so `offline-cache.ts` still owns the file seam without re-exporting functions.

### Blocked / needs a decision

None.


## Review (written by Claude)

Approved. The pre-review was clean (0 findings after the fix round). Net −31 without tests, and the cache tests keep every case.

**What changed:**
- One debounced writer (`createMessageCacheWriter`) and one snapshot builder (`buildCacheSnapshot`) in client-core.
- The web's timer map is gone. The phone's file queue moved unchanged. The phone chat-list file also uses the shared file port.
- Sign-out now runs the writer's `clear()`, whose fence stops a late write from recreating the key.

**Lead checks:**
- Web mock, branch and main identical: the cache key is written 2 s after a send, the text survives a reload, and a pagehide flushes at once.
- Phone emulator: the smoke passes, and Ana's chat opens right after a kill and relaunch. Mock mode reloads the mock history over the cache, so the cold-start paint from the file itself waits for the next real APK.

**Fix round:**
- `flushMessageCache` / `scheduleMessageCache` instead of bare `flush` / `schedule`;
- the privacy note ("no token and no media bytes") restored on `buildCacheSnapshot`.
