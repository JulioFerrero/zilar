---
id: T-1303
title: "Push: the native wake payload carries chatKind ('dm' | 'group' | 'channel') so the phone posts each notification on the right channel (T-1302 follow-up); tested"
status: merged
milestone: M5
branch: task/T-1303-push-chat-kind
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1303: chatKind in the push wake payload

## Spec (written by Claude, do not edit)

### Why
T-1302 gave the phone three notification channels: "Direct messages", "Groups" and "Channels" (`apps/mobile/src/lib/push/channels.ts`, `PushChatKind = 'dm' | 'group' | 'channel'`). It reads the kind from the wake's `chatKind` field (`apps/mobile/src/lib/push/background.ts:85-91`). The server doesn't send that field yet, so every notification, DMs included, lands on "Groups".
- `buildNativeWakePayload` (`apps/server/src/push/payload.ts:86-98`) returns only `{ chatId, messageId?, serverId }`, typed `FcmWakeData` (`apps/server/src/push/fcm.ts:10-14`).
- `ResolvedPushMessage` (`apps/server/src/push/payload.ts:24-37`) has no kind.
- The resolver knows it:
  - `resolveCandidate` picks `resolveRoomCandidate` for `row.kind === 'groupchat'` and `resolveDmCandidate` otherwise (`apps/server/src/push/candidates.ts:45-48`);
  - the group row has `kind` (`'channel'` for channels; see `apps/server/src/groups/members.ts:262`).

### What to build
1. Add `chatKind: 'dm' | 'group' | 'channel'` to `ResolvedPushMessage`:
   - `resolveDmCandidate` sets `'dm'`;
   - `resolveRoomCandidate` sets `'channel'` when the room's group has `kind === 'channel'`, otherwise `'group'`. Reuse the group row it already loads, or add the column to its existing query; cite it, and don't add an extra query per message if one already loads the group.
2. Add `chatKind` to `FcmWakeData`, and set it in both returns of `buildNativeWakePayload`.
3. **Tests** (the message pipeline), up to 2, in `apps/server/src/push/candidates.test.ts` and/or the nearest payload or FCM test:
   - a DM candidate → `chatKind: 'dm'`;
   - a channel room → `'channel'`, and the wake payload carries it.

### Read first
`AGENTS.md`, `apps/server/src/push/payload.ts`, `apps/server/src/push/fcm.ts`, `apps/server/src/push/candidates.ts` and `apps/mobile/src/lib/push/channels.ts`.

### Allowed files
`apps/server/src/push/*.ts`, `work/T-1303-push-chat-kind.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass. No migration. Every file stays at most 400 lines.

---

## Report (written by the worker when done)

### What I did

The native FCM wake now carries the chat kind, so the phone can post each
notification on the right Android channel (T-1302).

- `apps/server/src/push/fcm.ts`: added `export type PushChatKind = 'dm' | 'group' | 'channel'`
  and a required `chatKind: PushChatKind` on `FcmWakeData`. `fcmMessageBody` copies
  `chatKind` into the wire `data` block, so it reaches the device.
- `apps/server/src/push/payload.ts`: `ResolvedPushMessage` gained
  `chatKind: PushChatKind` (imported from `./fcm`, the direction the type-only import
  already ran). `buildNativeWakePayload` sets `chatKind` in both returns.
- `apps/server/src/push/candidates.ts`:
  - `resolveDmCandidate` sets `chatKind: 'dm'`.
  - `resolveRoomCandidate` sets `chatKind: group.kind === 'channel' ? 'channel' : 'group'`,
    reusing the `GroupRow` it already loads (`SELECT * FROM groups WHERE id = ${topic.groupId}`,
    which includes `kind`; `GroupRow.kind` is `'group' | 'channel'` in `db/rows.ts`). No extra query.
- Tests (2 new, in `candidates.test.ts`, the message pipeline):
  - "marks a DM candidate as a dm" — a DM archive row → `message.chatKind === 'dm'`.
  - "marks a channel room as a channel and carries it in the native wake" — a group flipped
    to `kind = 'channel'` → `message.chatKind === 'channel'` and the wake payload built by
    `buildNativeWakePayload` carries `chatKind: 'channel'`.

Existing literals that build `ResolvedPushMessage`/`FcmWakeData` gained the now-required
`chatKind` (`candidates.test.ts`, `delivery.test.ts`, `fcm.test.ts`, `api-subscribe.test.ts`).

### Files changed

9 files, all inside the Allowed files (`apps/server/src/push/*.ts`,
`work/T-1303-push-chat-kind.md`):

- `apps/server/src/push/fcm.ts`, `payload.ts`, `candidates.ts`, `api-handlers.ts`
- `apps/server/src/push/candidates.test.ts`, `delivery.test.ts`, `fcm.test.ts`, `api-subscribe.test.ts`
- `work/T-1303-push-chat-kind.md`

### Commands and results

- `pnpm install` — done, 14.5s, no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/candidates.test.ts` — 13 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/candidates.test.ts src/push/fcm.test.ts src/push/delivery.test.ts src/push/api-subscribe.test.ts` — 30 passed, 1 failed (my first channel test used the group's own room JID instead of a topic room, so the lookup skipped; fixed in the test, then green).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push` — 10 files, 67 passed (the Checks command with the worker cap AGENTS.md asks for; it is the same `vitest run src/push`, with `--maxWorkers=2`).
- `pnpm gate` — summary:
  - `gate: 9 changed file(s) against main`
  - `PASS  install (frozen)  (6.0s)`
  - `PASS  format  (5.9s)`
  - `PASS  lint  (3.6s)`
  - `PASS  typecheck  (22.6s)`
  - `PASS  effect  (6.2s)`
  - `PASS  tests @zilar/server  (84.4s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `GATE PASS`

### Deviations from the spec

- `FcmWakeData.chatKind` is required (not optional). That made the synthetic test wake in
  `api-handlers.ts` (built directly, not via `buildNativeWakePayload`) need a kind; I set it to
  `'group'`, which is the channel the phone's test post already used (the wake `chatKind` is
  ignored for a test wake: `background.ts` `postTest` uses `channelForWake(undefined)`, whose
  fallback is `'group'`). `api-subscribe.test.ts` was updated to match. Required keeps the wake
  contract honest: `buildNativeWakePayload` always sets a kind.
- The `PushChatKind` type is defined server-side in `fcm.ts`; the mobile copy in
  `apps/mobile/src/lib/push/channels.ts` is not shared (different packages). Both list
  `'dm' | 'group' | 'channel'`.

### Blocked / needs a decision / open questions

None.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (1 follow-up).**
- **Lead's checks after the rebase:** server push vitest: 68 tests pass, including the dm and channel `chatKind` cases. server tsc: 0 errors.
- **Follow-up:** two mobile comments still say the server sends no kind (`apps/mobile/src/lib/push/channels.ts:33`, `apps/mobile/src/lib/push/background.ts:50-51`). This is comment-only, so it goes in the next mobile batch.
