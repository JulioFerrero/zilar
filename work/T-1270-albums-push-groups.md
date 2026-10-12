---
id: T-1270
title: "Albums push follow-up: one push per album in groups too, and late siblings stay silent — remember 'album:<id>:<sender>' in the per-device notified set (delivery markNotified), check it in the DM scan and the group poller"
status: merged
milestone: M5
branch: task/T-1270-albums-push-groups
model: auto
effort: default
depends_on: [T-1269]
estimate: 0.2 day
---

# T-1270: One push per album, everywhere

## Spec (written by Claude, do not edit)

### Why
These are T-1269's follow-ups F1 and F2 (`work/T-1269-albums-push.md`, Review and "Open question"):
- **F1:** the group poller delivers one push per archived row (`apps/server/src/push/group-notifier.ts:147-157`, `notify: [row.originId]`), so a 3-photo album in a group still buzzes 3 times, each reading "3 photos".
- **F2:** the DM scan marks only the album rows present in the scanned page (`apps/server/src/push/archive-scan.ts`), so a sibling whose archive row lands later can still notify.
- **What exists:** the per-device "already notified" memory is `recentlyNotified` (`apps/server/src/push/service.ts:39`), filled by `markNotified` (`apps/server/src/push/delivery.ts:256-269`, capped at 500 per node). T-1269 put `albumId` on `ResolvedPushMessage` (`apps/server/src/push/payload.ts`).

### What to build
1. **When a push is delivered for a message with `albumId`,** also add the key `album:<albumId>:<sender>` to the device's notified set:
   - `<sender>` is the room plus nick for a group, or the bare peer for a DM, using the same identity `archive-scan.ts`'s `sameSender` uses;
   - do it where `markNotified` runs (`delivery.ts`), with the scan's message passed in.
2. **Before delivering:**
   - **the DM scan:** in `archive-scan.ts`, skip a candidate whose album key is already in the node's set, and mark its origin id as notified;
   - **the group poller:** in `group-notifier.ts:153-157`, skip a device whose set already has the album key.
3. Keep every file at most 400 lines; put a small `albumKey(message)` helper in `payload.ts` or a new `apps/server/src/push/album-key.ts`.
4. **Tests** (the message pipeline), up to 2:
   - `apps/server/src/push/group-notifier.test.ts`: 3 same-album group rows produce 1 delivery per device;
   - `apps/server/src/push/candidates.test.ts`: a late sibling row after the album was delivered sends nothing.

### Read first
`AGENTS.md`, `work/T-1269-albums-push.md`, `apps/server/src/push/archive-scan.ts`, `apps/server/src/push/group-notifier.ts`, `apps/server/src/push/delivery.ts`, `apps/server/src/push/payload.ts`, `apps/server/src/push/service.ts` and the two test files.

### Allowed files
`apps/server/src/push/archive-scan.ts`, `apps/server/src/push/group-notifier.ts`, `apps/server/src/push/delivery.ts`, `apps/server/src/push/payload.ts`, `apps/server/src/push/album-key.ts`, `apps/server/src/push/group-notifier.test.ts`, `apps/server/src/push/candidates.test.ts`, `work/T-1270-albums-push-groups.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.

---

## Report (written by the worker when done)

### What I built

**`apps/server/src/push/album-key.ts` (new, 14 lines).** `albumKey(message)` returns
`album:<albumId>:<chatJid>:<senderName>` when the message carries an `albumId`, and
`undefined` otherwise. `chatJid` is the room for a group and the bare peer for a DM;
`senderName` is the room nick for a group — the same sender identity
`archive-scan.ts`'s `sameSender` pairs (owner/nick for a room, bare peer for a DM).
One small helper shared by all three call sites.

**`apps/server/src/push/delivery.ts`.** `markNotified` now takes the delivered
message and, next to the origin ids, adds `albumKey(message)` to the per-node set
(still capped at 500). This is the write side of both dedupes (spec item 1).

**`apps/server/src/push/archive-scan.ts`.** After a candidate resolves to `ok`, if
its album key is already in the node's set the row's origin id is remembered and the
scan moves on, so a sibling whose MAM row lands after the album was delivered
(F2) delivers nothing (spec item 2, DM scan).

**`apps/server/src/push/group-notifier.ts`.** In the per-device loop a device is
skipped when its set holds the row's origin id or the message's album key, so a
3-photo group album buzzes once per device (spec item 2, group poller; F1).

### Files changed
`apps/server/src/push/album-key.ts` (new), `apps/server/src/push/delivery.ts`,
`apps/server/src/push/archive-scan.ts`, `apps/server/src/push/group-notifier.ts`,
`apps/server/src/push/group-notifier.test.ts`, `apps/server/src/push/candidates.test.ts`,
`work/T-1270-albums-push-groups.md`. All are inside the Allowed files and all are
≤ 400 lines (largest: candidates.test.ts 399, archive-scan 280, delivery 281,
group-notifier 265, group-notifier.test.ts 247, album-key 14).

### Tests (2 new, message pipeline)
- `group-notifier.test.ts`: **"delivers a 3-photo album once per device"** — three
  same-album groupchat rows (`albumRow` helper) send exactly one push to an offline
  member; added a new small `albumRow` builder next to `groupchatRow`.
- `candidates.test.ts`: **"sends nothing for an album sibling that lands after
  delivery"** — the node's set already holds the album key; the late sibling row
  yields no candidate and its origin id is marked notified. I also extracted a small
  `albumDmRow` helper and reused it in the existing 3-photo album test, which keeps
  the file under 400 lines.

### Commands (real results)
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/group-notifier.test.ts src/push/candidates.test.ts`
  → **15 passed** (2 files), twice (before and after the test refactor).
- `pnpm gate` → **GATE PASS**:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.0s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.5s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/server  (11.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  Gate runs the nearest tests of the touched package, which includes
  `delivery.test.ts` and the other tests in `apps/server/src/push`, so the spec's
  `src/push` check is covered. (One earlier gate run failed on `format` for
  `candidates.test.ts` and `group-notifier.ts`; I fixed them with
  `prettier --write` on those two files and re-ran the gate to PASS.)

### Deviations / notes
- The DM scan checks the album key **after** `resolveCandidate` (that path already
  resolves every fresh unseen row) rather than parsing the marker a second time
  before resolving; the observable behaviour is the same and no XML parsing is
  duplicated.
- `albumKey` includes the sender display name even for a DM, where the bare peer
  (`chatJid`) already identifies the sender. That keeps one helper for both kinds;
  the extra name is stable for a given peer within the notified window.
- `payload.ts` was left unchanged; the helper lives in the new `album-key.ts`.

### Open questions
- None blocking. Residual (same as T-1269's): the memory is per process, so a
  restart inside the window can re-notify an album — unchanged from the existing
  origin-id dedupe.


## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (2 nits); the reviewer confirmed both new tests fail without the fix.**
- **The change:**
  - `album-key.ts` builds `album:<id>:<sender>`;
  - `markNotified` also stores the album key when the delivered message has `albumId`;
  - the DM scan skips (and marks) a late sibling whose album key is known;
  - the group poller skips a device that already got the album.
- **Lead's checks:** all server push tests, 65 passed; server tsc: 0 errors.
- **Live check, needs Julio's phone:** a 3-photo album in a DM and in a group each buzz once.
