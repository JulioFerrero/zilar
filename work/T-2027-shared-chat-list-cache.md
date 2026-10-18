---
id: T-2027
title: "Share W1-f: one chat-list cache codec in client-core (version, 200-chat cap, schemas, date rehydrate, owner check, live fields dropped) — web keeps its sync localStorage wrapper, phone its async file — net about −120 lines, with tests"
status: merged
milestone: M5
branch: task/T-2027-shared-chat-list-cache
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2027: Shared chat-list cache codec (share plan W1-f)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: share functions between web and phone to reduce code. `docs/audit/share-plan.md` §2.2 and slice **W1-f** found the chat-list cache codec copied byte for byte in both apps. The net saving is about 120 lines. The cache is in the message pipeline, so tests are required.

### Facts (from `docs/audit/share-plan.md` §2.2, read by the lead on 2026-10-18)
- **The two copies.** `apps/web/src/store/chatListCache.ts` (151 lines) and `apps/mobile/src/lib/chat-list-cache.ts` (191 lines).
- **The same in both:**
  - version and the 200-chat cap (web:10-11, mobile:19-20);
  - schemas, byte for byte (web:15-48, mobile:24-57);
  - `rehydrateDate` (web:53-59), which is the same function as `parseCachedDate` (mobile:107-113);
  - decode (web:74-107, mobile:128-150);
  - encode (web:121-139, mobile:164-182).
- **Platform-specific, stays in each app:**
  - web reads and writes synchronous storage under the key `zilar:chatList` (web:9,70,139);
  - mobile writes an async file (mobile:18,64-100).
- **Drift.** Mobile always assigns `createdAt` and `pinnedAt`, even when they're `undefined` (mobile:137-138). Web assigns them only when valid (web:88-95). **Web's rule wins.**
- **Barrel.** The client-core store barrel `packages/client-core/src/store/index.ts` (64 lines) ends with the T-2019 message-cache export at lines 63-64.

### Steps
1. **The shared codec.** Create `packages/client-core/src/store/chat-list-cache.ts` with:
   - `encodeChatListCache(userId, chats): string`;
   - `decodeChatListCache(raw, userId?)`, which returns the chats or `undefined`, on a wrong version, a wrong owner or bad JSON;
   - the shared version, the cap and the schemas.

   Use web's rule for optional dates. Keep it under about 110 lines and its comments short.
2. **The barrel.** Add ONE export line to `packages/client-core/src/store/index.ts`, **right after line 64** (`export * from './message-cache';`). Add no comment line, so the diff stays one line.
3. **The apps keep only their storage wrappers.** `apps/web/src/store/chatListCache.ts` and `apps/mobile/src/lib/chat-list-cache.ts` call the shared codec and keep their read/write/clear wrappers. Exported names stay the same, so importers don't change.
4. **Tests** in a new `packages/client-core/src/store/chat-list-cache.test.ts`:
   - a round trip keeps `lastMessageAt`, `createdAt` and `pinnedAt` as `Date`s;
   - live fields (presence, typing, whatever the schema drops) are not written;
   - another user's cache decodes to `undefined`;
   - more than 200 chats are capped;
   - bad JSON gives `undefined`.
5. **Fewer lines.** Product lines (non-test, the three files) must end at **at most 240**, against 342 today. Put the before and after counts in the Report. Every file stays at or under 400 lines.

### Allowed files
- `packages/client-core/src/store/chat-list-cache.ts`
- `packages/client-core/src/store/chat-list-cache.test.ts`
- `packages/client-core/src/store/index.ts`
- `apps/web/src/store/chatListCache.ts`
- `apps/mobile/src/lib/chat-list-cache.ts`
- `work/T-2027-shared-chat-list-cache.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/chat-list-cache.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- Product lines are at most 240.

---

## Report (written by the worker when done)

### What I did

- Added `packages/client-core/src/store/chat-list-cache.ts` (116 lines): the shared version `1`, the 200-chat cap, the passthrough schemas, `encodeChatListCache(userId, chats): string` and `decodeChatListCache(raw, userId?): { userId; chats } | undefined`. Dates are rehydrated with web's rule (`createdAt`/`pinnedAt` only when valid); `online`, `onlineCount`, `lastSeenAt` and `aiStatus` are dropped on encode.
- Added one barrel line in `packages/client-core/src/store/index.ts`, directly after `export * from './message-cache';`.
- Rewrote `apps/web/src/store/chatListCache.ts` (151 → 46 lines) and `apps/mobile/src/lib/chat-list-cache.ts` (191 → 78 lines) as storage wrappers over the shared codec. Exported names and signatures are unchanged, so no importer changed.
- Added `packages/client-core/src/store/chat-list-cache.test.ts` (78 lines) with six cases: date round trip (row + last message), live fields not written, another user's cache, the 200 cap, bad JSON, wrong version.
- Product lines (non-test, the three files): **342 → 240** (web 151 → 46, mobile 191 → 79, shared 0 → 115). Every file is under 400 lines.

Deviation from the spec: `decodeChatListCache` returns `{ userId, chats } | undefined` instead of only the chats. Both wrappers must return the cached owner (`lifecycle.ts` uses `cached.userId` for `cachedUserId` and `readMessageCache`), and their callers are outside the Allowed files, so the owner cannot come from anywhere else. A wrong version, a wrong owner or bad JSON still returns `undefined`. It is exported from the barrel either way.

Both app wrappers now carry a `// effect-plain:` marker: moving the Effect schema import into client-core makes the remaining storage seams (try/catch, async expo file API) `needs-effect` files, and the ratchet flagged them. The markers state that these are deliberately plain storage edges; the codec itself is the Effect module.

### Checks run

- `pnpm install` — ok.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/chat-list-cache.test.ts` — 1 file passed, 6 tests passed.
- `pnpm gate` — 6 changed files, all inside the Allowed files:
  ```
  PASS  install (frozen)  (2.1s)
  PASS  format  (1.1s)
  PASS  lint  (1.1s)
  PASS  typecheck  (4.2s)
  PASS  effect  (0.5s)
  PASS  build @zilar/server  (0.6s)
  PASS  tests @zilar/client-core  (11.5s)
  PASS  tests @zilar/mobile  (5.5s)
  PASS  tests @zilar/web  (8.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

The only deviation is the decode return shape described above; if you want the literal `chats` return, the wrappers would need their callers changed, which are outside this task's Allowed files.

### Round (fix round 1, 2026-10-18)

- **Finding 1 (must-fix), fixed.** `writeChatListCache` in `apps/mobile/src/lib/chat-list-cache.ts` wraps `encodeChatListCache` in the `try/catch` again, so a serialization failure (for example an invalid `lastMessage.createdAt` in `.toISOString()`) is swallowed instead of propagating into `saveChatListNow`. One commit: `T-2027: fix finding 1 - guard the mobile cache encode`.
- **Test for finding 1.** Added a client-core case proving `encodeChatListCache` throws on an invalid last-message date — the failure the mobile wrapper now catches. A direct wrapper test would need `apps/mobile/src/lib/chat-list-cache.test.ts`, which is outside the Allowed files, so it was not added.
- **Finding 2 (should-fix), fixed.** The live-fields test now sets `lastSeenAt` on its fixture and asserts the payload has no `lastSeenAt`, alongside `online`, `onlineCount` and `aiStatus`. One commit: `T-2027: fix finding 2 - assert lastSeenAt is not cached`.
- **Finding 3 (nit), not fixed.** The shared codec is 115 lines (was 116): one comment line was merged to keep product lines at 240 after finding 1's guard. It remains above the "about 110" target, as the nit allows.
- **Line count.** Product lines are still **240**: web 46, mobile 79, shared 115.
- **Commands.** `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/chat-list-cache.test.ts` → 1 file passed, 7 tests passed. `pnpm gate` → `GATE PASS`:
  ```
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.6s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.1s)
  PASS  effect  (1.5s)
  PASS  build @zilar/server  (1.3s)
  PASS  tests @zilar/client-core  (6.0s)
  PASS  tests @zilar/mobile  (1.3s)
  PASS  tests @zilar/web  (3.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Status stays `review`.


## Review (written by Claude)

Approved after 1 auto round; the pre-review was clean, with 2 nits.
- **What changed.** One chat-list cache codec in client-core `store/chat-list-cache.ts`: version, 200-chat cap, schemas, date rehydrate, owner check, and live fields left out. Web keeps its sync storage wrapper and the phone its async file.
- **Size.** Product lines went from 342 to 240, which is −102.
