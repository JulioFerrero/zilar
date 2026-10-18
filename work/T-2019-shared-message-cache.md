---
id: T-2019
title: "Share W1-g: one message-cache codec in client-core (encode/decode with owner check, editedAt as a Date, local-URL strip, byte cap, open chat kept); the phone's offline cache uses it — fixes the cold-start editedAt crash risk — with tests"
status: merged
milestone: M5
branch: task/T-2019-shared-message-cache
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2019: Shared message-cache codec, phone side (share plan W1-g)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: "reduce the code we have, share components and functions". The share plan (`docs/audit/share-plan.md` §2.3 and slice **W1-g** in §5) found that web and phone each write their own offline message cache codec. The phone's copy also has a bug.

This slice:
- moves the codec into `client-core`;
- switches the **phone** to it;
- leaves web alone (web follows in W2-b).

It is the message pipeline, so tests are required.

### Facts (from `docs/audit/share-plan.md` §2.3, checked by the lead on 2026-10-18 at `754a53c34`)
- **The phone cache.** `apps/mobile/src/store/offline-cache.ts` (369 lines):
  - `encodeMessage` only turns `createdAt` into a string (`:132-136`), and `decodeMessage` only turns `createdAt` back into a `Date` (`:152-159`);
  - so after a cold start `editedAt` is a string, while `UiMessage.editedAt` is a `Date` (`packages/chat-core/src/types.ts:110`);
  - `formatTime` calls `date.getHours()` (`packages/chat-core/src/format.ts:18-19`), and `packages/client-core/src/store/ledger-edits.ts` calls `editedAt?.getTime()`.
- **Pins.** The phone's pin decoding lives in `apps/mobile/src/store/offline-cache-pins.ts` (53 lines).
- **The same in both copies:** version, 50 messages per chat, `isCacheable`, `stripLocalFields`, the schemas, pin decoding, and the owner check. The plan's §2.3 lists the line pairs, web against mobile.
- **The web copy** (`apps/web/src/store/messageCache.ts`, 306 lines) already restores `editedAt` (web:96, 103-112). It isn't touched here.

### Steps
1. **The shared codec.** Create `packages/client-core/src/store/message-cache.ts` exporting:
   - `encodeMessageCache(snapshot, { localUrlPrefixes, maxBytes? })`;
   - `decodeMessageCache(raw, userId)`, which returns `null` on a wrong owner, a wrong version or a bad shape;
   - `selectCachedChats(chats, activeChatId, max)`, which keeps the open chat even past the cap, as the phone does today (mobile:196-209).

   Encoding writes `createdAt` and `editedAt` as ISO strings. Decoding restores both as `Date`s, and a bad date becomes `new Date(0)` (`createdAt`) or is dropped (`editedAt`). Add one export line at the end of `packages/client-core/src/store/index.ts`; never reorder it.
2. **The phone.** `apps/mobile/src/store/offline-cache.ts` keeps its async file queue and its exported API, but uses the shared codec with `localUrlPrefixes: ['file://', 'data:']`. Delete `apps/mobile/src/store/offline-cache-pins.ts`. Move whatever of `apps/mobile/src/store/offline-cache.test.ts` still applies into the new shared test, or keep it if it tests the file queue.
3. **Tests** in a new `packages/client-core/src/store/message-cache.test.ts`:
   - an `editedAt` round trip comes back as a `Date`;
   - another user's cache decodes to `null`;
   - local URLs are stripped;
   - the byte cap drops the oldest chats first;
   - the open chat is kept.
4. **Keep files small.** Every file stays at or under 400 lines. No web changes.

### Allowed files
- `packages/client-core/src/store/message-cache.ts`
- `packages/client-core/src/store/message-cache.test.ts`
- `packages/client-core/src/store/index.ts`
- `apps/mobile/src/store/offline-cache.ts`
- `apps/mobile/src/store/offline-cache-pins.ts`
- `apps/mobile/src/store/offline-cache.test.ts`
- `work/T-2019-shared-message-cache.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/message-cache.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- The lead's mock smoke: edit a message, kill the app, cold start; "edited HH:mm" shows with no crash.

---

## Report (written by the worker when done)

### What I did
- Added `packages/client-core/src/store/message-cache.ts` with the shared codec:
  - `encodeMessageCache(snapshot, { localUrlPrefixes, maxBytes? })` writes the
    newest 50 settled rows per chat, `createdAt` and `editedAt` as ISO strings,
    drops `file://`/`data:`/`blob:` media plus the mobile-only `localUri` /
    `uploadProgress`, and applies the byte cap by dropping the oldest chats
    first (last entries of the newest-first record), then a single chat's
    oldest rows, then its pins, then everything.
  - `decodeMessageCache(raw, userId)` returns `null` on bad JSON, a bad shape,
    a version other than 1 or another owner; restores `createdAt` and
    `editedAt` as `Date`s, uses `new Date(0)` for a bad `createdAt` and drops a
    bad `editedAt`; decodes pins leniently (a bad pin costs only the pins).
  - `selectCachedChats(chats, activeChatId, max)` keeps the open chat past the
    cap, exactly as the phone did.
- Exported it with one line at the end of `packages/client-core/src/store/index.ts`.
- Rewrote `apps/mobile/src/store/offline-cache.ts` to keep its exported API and
  its debounced file queue but delegate the format to the shared codec with
  `localUrlPrefixes: ['file://', 'data:']`; `offlineSnapshot` now uses
  `selectCachedChats`. Added one `effect-plain:` marker at the top because the
  Effect `Schema` import moved to the shared codec and the remaining async is
  the injected file port.
- Deleted `apps/mobile/src/store/offline-cache-pins.ts`; its pin encoding and
  lenient decoding now live in the shared codec. The cache version stays 1 and
  the field names are unchanged, so existing files still decode.
- Added `packages/client-core/src/store/message-cache.test.ts` (9 tests): the
  five required cases (`editedAt` as a `Date`, another owner, local-URL strip,
  byte cap dropping the oldest chats, open chat kept) plus a bad `editedAt`
  drop, bad shape/version, in-flight rows and pins round trip/leniency.
- Trimmed `apps/mobile/src/store/offline-cache.test.ts` to what still applies
  to the phone: store hydration/merge, another user's file, sign-out removal
  and `clear()` waiting for an in-flight write (4 tests). Codec cases moved to
  the shared test.

### Checks run
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/message-cache.test.ts`: 1 file passed, 9 tests passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/offline-cache.test.ts`: 1 file passed, 4 tests passed.
- `pnpm gate` (from the repo root), final run:
  ```
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.7s)
  PASS  lint  (2.2s)
  PASS  typecheck  (5.4s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/client-core  (18.9s)
  PASS  tests @zilar/mobile  (7.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  Earlier gate runs caught: prettier formatting on the new files (fixed with
  `pnpm exec prettier --write` on only my four files), one unused helper in the
  codec (removed), and the Effect ratchet on `offline-cache.ts` (fixed with the
  `effect-plain:` marker explained above).

### Notes for the lead
- Files changed: new `packages/client-core/src/store/message-cache.ts` and
  `message-cache.test.ts`; `packages/client-core/src/store/index.ts`; rewritten
  `apps/mobile/src/store/offline-cache.ts`; trimmed
  `apps/mobile/src/store/offline-cache.test.ts`; deleted
  `apps/mobile/src/store/offline-cache-pins.ts`; this task file.
- The byte cap is opt-in (`maxBytes`); the phone passes none, matching today's
  behaviour. Web can enable it when W2-b switches over; the record order is
  assumed newest-first, as both apps build it.
- The edit, kill, cold-start smoke ("edited HH:mm" with no crash) was not run
  by me; it needs the lead's phone.


## Review (written by Claude)

Approved: a clean pre-review with 3 nits.
- **The shared codec.** `client-core/src/store/message-cache.ts` holds the codec: owner check, local-URL strip, byte cap, open chat kept. It restores `createdAt` and `editedAt` as Dates.
- **The phone.** It now uses the codec. `offline-cache-pins.ts` is gone, and the phone's cache code shrinks by 344 lines.
- **The editedAt nit is harmless.** The encoder only sees Dates, because the decoder now restores them, including from old cache files.
- **Web** switches to this codec in W2-b.
- **Still to check:** the phone check (edit a message, cold start offline) is part of the combined smoke after wave 1.
