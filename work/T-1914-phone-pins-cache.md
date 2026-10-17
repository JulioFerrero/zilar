---
id: T-1914
title: "Smooth app P1 (phone): the offline cache also keeps the cached chats' pins and the hydrate seeds them, so the phone pinned banner is there when a chat opens instead of dropping the thread when the pins answer"
status: merged
milestone: M5
branch: task/T-1914-phone-pins-cache
model: auto
effort: default
depends_on: [T-1904]
estimate: 40 min
---

# T-1914: The phone pinned banner is there when a chat opens

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/smooth-app.md` §4 P1** (the twin of T-1913 for the web). The pinned banner (`apps/mobile/src/components/chat/pinned-banner.tsx:50-53` returns `null` with no pins) pops in above the thread when the pins answer, which drops every message.

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/store/offline-cache.ts`** (350 lines):
  - `encodeOfflineCache(snapshot)` (`:132`) and `decodeOfflineCache(raw, userId)` (`:157`);
  - `offlineSnapshot(userId, chats, messagesByChat, activeChatId?)` (`:204`), which keeps the first 50 chats plus the open one (T-1904);
  - the snapshot's `messages: Record<string, UiMessage[]>` (`:32`);
  - the file schema has `version: Schema.Literal(CACHE_VERSION)` and `messages` (`:79-81`).
- **`apps/mobile/src/store/offline-cache-sync.ts:38-50`:** `watch(store)` subscribes and calls `offlineSnapshot(state.me?.id, state.chats, state.messagesByChat, getActiveChatId())` on every store change, debounced.
- **Pins** live in a closure map in `apps/mobile/src/store/effects/pins.ts:58` (`pinsByChat`, published by `publishPins` `:64-71`). The store action `pins: (chatId) => Pin[]` (`:127-132`, typed in `apps/mobile/src/store/types.ts:228`) reads it.
- **The hydrate** is `hydrateOfflineCache` in `apps/mobile/src/store/effects/lifecycle.ts:107-125` (342 lines). It seeds `messagesByChat` for chats not already loaded.

### Steps
1. **The offline cache:**
   - the snapshot gains an optional `pins: Record<chatId, Pin[]>`, decoded leniently (missing or bad reads as `{}`, a bad entry is dropped), with the version unchanged;
   - `offlineSnapshot` takes an optional `pinsFor?: (chatId) => readonly Pin[]` and stores the non-empty lists of the kept chats.

   **Size:** if `offline-cache.ts` would pass 400 lines, put the pins encode/decode helpers in a new `apps/mobile/src/store/offline-cache-pins.ts`.
2. **`offline-cache-sync.ts`:** pass `(chatId) => state.pins(chatId)` to `offlineSnapshot`.
3. **`effects/pins.ts`:** add a store action `seedCachedPins(pins: Record<string, readonly Pin[]>)`. It publishes each chat's cached pins **only when that chat has none loaded yet**, through `publishPins`, so selectors re-fire. Add it to the `PinActions` type in `apps/mobile/src/store/types.ts`.
4. **`effects/lifecycle.ts`:** in `hydrateOfflineCache`, after the messages, call `get().seedCachedPins(cached.pins ?? {})`. The normal pin load on open still replaces them.
5. **Test:** in `apps/mobile/src/store/offline-cache.test.ts`, add one case: pins round-trip in the snapshot, and the file of another user decodes to null as today.
6. **Size:** files stay at most 400 lines.

### Allowed files
- `apps/mobile/src/store/offline-cache.ts`
- `apps/mobile/src/store/offline-cache-pins.ts`
- `apps/mobile/src/store/offline-cache-sync.ts`
- `apps/mobile/src/store/offline-cache.test.ts`
- `apps/mobile/src/store/effects/pins.ts`
- `apps/mobile/src/store/effects/lifecycle.ts`
- `apps/mobile/src/store/types.ts`
- `work/T-1914-phone-pins-cache.md`

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run src/store/offline-cache.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **A cold start opening a cached chat with pins** shows the pinned banner at once, and the thread doesn't drop.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **`apps/mobile/src/store/offline-cache.ts`**: `OfflineCacheSnapshot` gained an
  optional `pins: Record<string, Pin[]>`; the file schema accepts an optional
  `pins` field with `version` still `1`; `encodeOfflineCache` writes the
  non-empty lists; `decodeOfflineCache` returns the leniently decoded pins;
  `offlineSnapshot` takes a fifth optional `pinsFor?: (chatId) => readonly
  Pin[]` and records the non-empty pins of the kept chats.
- **`apps/mobile/src/store/offline-cache-pins.ts`** (new, 53 lines): encodes the
  non-empty lists and decodes per row with the contract `Pin` schema. A missing
  or unusable `pins` value reads as `{}`, and a bad chat entry or pin row is
  dropped without discarding the rest. This lives in its own file because
  `offline-cache.ts` was already 350 lines; it now ends at 369, under the cap.
- **`apps/mobile/src/store/offline-cache-sync.ts`**: passes `(chatId) =>
  state.pins(chatId)` to `offlineSnapshot`.
- **`apps/mobile/src/store/effects/pins.ts`**: added the `seedCachedPins`
  action to `PinActions`; it publishes each cached list through `publishPins`
  only when that chat has no pins loaded yet (`pinsByChat.has(chatId)`), so
  selectors re-fire and an already-loaded chat is untouched.
- **`apps/mobile/src/store/types.ts`**: added `seedCachedPins` to
  `ChatStoreState`.
- **`apps/mobile/src/store/effects/lifecycle.ts`**: `hydrateOfflineCache`
  calls `get().seedCachedPins(cached.pins ?? {})` right after seeding the
  messages.
- **`apps/mobile/src/store/offline-cache.test.ts`**: one new case: the pins
  round-trip through snapshot encode/decode, another user's file still decodes
  to null, and a partly corrupt `pins` field costs the pins but not the
  messages.

Changed files: `offline-cache.ts`, `offline-cache-pins.ts` (new),
`offline-cache-sync.ts`, `offline-cache.test.ts`, `effects/pins.ts`,
`effects/lifecycle.ts`, `types.ts`, and this task file.

### Checks run

- `pnpm install` — done in 18.7s.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot
  src/store/offline-cache.test.ts` — `Test Files 1 passed (1)`,
  `Tests 7 passed (7)`.
- `pnpm gate` — exit 0 (final run; timings vary run to run):

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (1.3s)
PASS  lint  (0.8s)
PASS  typecheck  (0.9s)
PASS  effect  (0.8s)
PASS  tests @zilar/mobile  (6.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- When no kept chat has pins, the file omits `pins` entirely, so caches for
  users without pins are byte-identical to before.
- The open chat's normal pin load still runs on open and replaces the seeded
  list; `seedCachedPins` never overwrites a chat that already has pins.
- No device smoke was run: the cold-start banner itself was not observed on a
  phone here. The round-trip and the hydration wiring are covered by the test
  and the gate.
- Deviations from the spec: none.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `fec070b80`.
- **The change:**
  - the snapshot gains lenient optional `pins` (helpers in the new `offline-cache-pins.ts`; `offline-cache.ts` is 369 lines), and the sync passes `state.pins`;
  - `seedCachedPins` publishes only for chats with nothing loaded, and the hydrate calls it after the messages.
- **The follow-up goes to T-1916:** the in-memory pins map is never cleared on sign-out. This predates T-1914; a DM peer shared with the next user could show the old pins until the load replaces them.
