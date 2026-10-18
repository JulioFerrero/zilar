---
id: T-2032
title: "Share W2-b: web's offline message cache uses the shared client-core codec (T-2019) — encode/decode/pins/local-URL strip/byte cap come from client-core; web keeps only its sync storage read/write/clear, its 30-chat cap, 1.5 MB cap and 2 s delay — net about −200 lines; existing web cache test kept green"
status: merged
milestone: M5
branch: task/T-2032-web-message-cache-shared
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2032: The web message cache uses the shared codec (share plan W2-b)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: share functions between web and phone to reduce code. T-2019 (merged) moved the offline message-cache codec into client-core, and the phone uses it. Web still has its own 306-line copy. `docs/audit/share-plan.md` §2.3 and slice **W2-b** move web onto the shared codec. This is the message pipeline, so the existing web test must stay green.

### Facts (read by the lead on 2026-10-18 at `d8523011e`)
- **The shared codec.** `packages/client-core/src/store/message-cache.ts` (300 lines) exports:
  - `MessageCacheSnapshot` (`:16`);
  - `EncodeMessageCacheOptions { localUrlPrefixes, maxBytes? }` (`:23`);
  - `selectCachedChats(...)` (`:197`);
  - `encodeMessageCache(snapshot, options)` (`:264`);
  - `decodeMessageCache(raw, userId)` (`:280`).

  The store barrel exports it (`packages/client-core/src/store/index.ts`, `export * from './message-cache';`).
- **The web copy.** `apps/web/src/store/messageCache.ts` (306 lines) has its own:
  - version, schemas, `isLocalUrl` (`blob:` and `data:`, `:59`), `isCacheable`, `stripLocalFields`;
  - `encodeMessage` and `decodeMessage`, `decodePins`, `serialize`, `byteLength`, `readPayload`.

  Its exports are:
  - `MESSAGE_CACHE_KEY` (`'zilar:messages'`, `:12`) and `MESSAGE_CACHE_WRITE_DELAY_MS` (`2_000`, `:21`);
  - `readMessageCache` (`:205`), `readCachedPins` (`:224`), `writeMessageCache` (`:241`) and `clearMessageCache` (`:300`).

  Its caps are 30 chats (`:14`) and 1.5 MB (`:18`).
- **Importers** of `messageCache`: `apps/web/src/store/effects/lifecycle.ts`, `apps/web/src/lib/api/sessionGone.ts` and their tests. **Keep every exported name and signature**, so they don't change.
- **The test.** `apps/web/src/store/messageCache.test.ts` is 165 lines.

### Steps
1. **Rewrite the web module.** `apps/web/src/store/messageCache.ts` becomes a thin adapter:
   - keep `MESSAGE_CACHE_KEY`, `MESSAGE_CACHE_WRITE_DELAY_MS`, the 30-chat cap and the 1.5 MB cap;
   - `writeMessageCache` calls `selectCachedChats` (cap 30) and then `encodeMessageCache(..., { localUrlPrefixes: ['blob:', 'data:'], maxBytes: 1_500_000 })`;
   - `readMessageCache` and `readCachedPins` call `decodeMessageCache`;
   - `clearMessageCache` stays;
   - delete every local schema and codec helper.

   Target: **at most 90 lines.**
2. **Old caches.** If a value written by the old web format no longer decodes, return `null` (no crash). It's only a one-time cold paint. Say in the Report whether the formats matched.
3. **The test.** Keep `apps/web/src/store/messageCache.test.ts` passing. Adjust only assertions about removed internals, and keep every behaviour case: round trip, owner check, byte cap, local URLs stripped, pins.
4. **Size.** Report the before and after line counts. Every file stays at or under 400 lines.

### Allowed files
- `apps/web/src/store/messageCache.ts`
- `apps/web/src/store/messageCache.test.ts`
- `work/T-2032-web-message-cache-shared.md`

### Checks
```bash
pnpm --filter @zilar/web exec vitest run src/store/messageCache.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The test passes, and the gate passes.
- `apps/web/src/store/messageCache.ts` is at most 90 lines.

---

## Report (written by the worker when done)

### What I did

Rewrote `apps/web/src/store/messageCache.ts` as a thin adapter over the shared
codec (`@zilar/client-core/store`, T-2019):

- kept `MESSAGE_CACHE_KEY`, `MESSAGE_CACHE_WRITE_DELAY_MS`, the 30-chat cap and
  the 1.5 MB cap;
- `writeMessageCache` builds the chat-ordered `messages` map from
  `selectCachedChats(chats, null, 30)` (web has no active-chat argument, so its
  signature is unchanged) and calls
  `encodeMessageCache(..., { localUrlPrefixes: ['blob:', 'data:'], maxBytes: 1_500_000 })`;
- `readMessageCache` and `readCachedPins` call `decodeMessageCache`; a snapshot
  owned by another user still drops the key, as before;
- `clearMessageCache` is unchanged;
- deleted all local schemas, `encodeMessage`/`decodeMessage`, `decodePins`,
  `serialize`, `byteLength` and `readPayload`.

Added a first-line `// effect-plain: ...` marker because the local Effect schemas
are gone; the Effect ratchet then flags the storage `try`/`catch`/`JSON.parse`.
This follows the phone's `apps/mobile/src/store/offline-cache.ts`, which uses the
same marker with the shared codec.

`apps/web/src/store/messageCache.test.ts` needed no changes: it only imports the
public functions, and all four behaviour cases (round trip/owner, byte cap,
local URL strip/unsent rows, pins) pass unchanged.

**Size:** `messageCache.ts` went from 306 to 90 lines (net −216 in that file);
the test stays at 165 lines. Both are under 400 lines.

**Old cache format:** it matches. The old web `serialize` wrote
`{ version: 1, userId, messages, pins? }` with the same per-message schema and ISO
`createdAt`/`editedAt`, and the shared codec uses version 1 and the identical
schema. Old web caches decode unchanged; anything else returns `null`/`{}` and
is repainted from history, without a crash.

### Checks run

- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/messageCache.test.ts`
  → 1 test file passed, 4 tests passed (`message cache (T-1903)`).
- `pnpm gate` from the repo root → summary:

  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  SKIP build @zilar/server (no server, package or manifest change)
  PASS  tests @zilar/web
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

Changed files are exactly `apps/web/src/store/messageCache.ts` and this task file.

### Notes for the lead

- The first `pnpm gate` run failed the Effect ratchet (`needs Effect (W4, W6)`)
  because the old file imported `effect` and the adapter no longer does; the
  `effect-plain` marker fixed it, mirroring the phone adapter. If you prefer the
  ratchet to stay silent without a marker, the alternative is to wrap the storage
  seam in an Effect module, which adds code for no behaviour.
- `selectCachedChats` supports keeping the open chat outside the cap, but the web
  write signature never received an active chat id, so it is called with `null`
  to keep every exported signature and behaviour identical.


## Review (written by Claude)

Approved; the pre-review was clean, with 1 nit.
- **What changed.** Web's message cache is now a 90-line adapter over the shared client-core codec. It keeps its key, the 2 s delay, the 30-chat cap and the 1.5 MB cap, and all exported names. It was 306 lines, so this is −216.
- **The stored format matches,** so existing browser caches still paint.
- **Tests.** The existing web cache test passes unchanged.
- **Note.** The `effect-plain` marker satisfies the Effect ratchet, as on the phone adapter.
