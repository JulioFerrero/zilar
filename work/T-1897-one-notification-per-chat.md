---
id: T-1897
title: "One notification per chat (plan task 4): the push preview also returns the chat's unread count (unreadForChats, single-chat scope); the phone posts each chat notification under the stable identifier chat:<chatId> with badge = unread, so a new message replaces that chat's notification instead of stacking"
status: merged
milestone: M5
branch: task/T-1897-one-notification-per-chat
model: auto
effort: default
depends_on: [T-1896]
estimate: 40 min
---

# T-1897: One notification per chat (plan task 4)

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/notification-actions.md` §3 and §6 task 4** (Julio approved it on 2026-10-17). Today every message posts its own notification, so a busy chat stacks many. Telegram shows one per chat with the newest line and a count.

### Facts (read by the lead on 2026-10-17)
- **The preview contract:** `PushPreview` is `{ title, body, chatId, archiveId? }` (`packages/api-contract/src/push.ts`, `archiveId` added by T-1893).
- **The preview handler:** `apps/server/src/push/api-handlers.ts` (257 lines) has `deps.archive` (`:155`), `userId`, and the verdict's `chatJid`. It returns `{ title, body, chatId, archiveId }` near `:221-229`.
- **The unread count:** `unreadForChats(db, config, archive, userId, scopes: Map<string, UnreadScope>)` → `Record<chatJid, { unread, … }>` (`apps/server/src/chats/unread.ts:174-180`). `UnreadScope` is `{ kind: 'dm'; peer } | { kind: 'room'; room }` (`:42`). The chat list builds scopes with the lower-cased JID (`apps/server/src/chats/list-handler.ts:194-212`). The DM vs room choice for the preview comes from `verdict.message.chatKind` (`'dm'` or a group/channel).
- **The phone poster:** `post(title, body, chatId, chatKind, ids?)` in `apps/mobile/src/lib/push/background.ts` schedules `{ content: { title, body, data, categoryIdentifier }, trigger: { channelId } }` with no `identifier` (T-1896 added `ids` and the category).
- **The library (plan §3):**
  - re-posting with the same `identifier` replaces the Android notification in place;
  - `content.badge` sets Android's number;
  - a successful action already dismisses by `notification.request.identifier` (`apps/mobile/src/lib/push/actions.ts:120`), so it keeps working with the new id.
- **Other dismissals:** reading in the app dismisses by `data.chatId` (`apps/mobile/src/lib/push/badge.ts:63-83`), which needs no change. The test wake keeps its own `TEST_WAKE_IDENTIFIER`.

### Steps
1. **`push.ts`:** add `unread: Schema.optional(Schema.Number)` to `PushPreview`, with a T-1897 comment.
2. **`api-handlers.ts`:** after a successful verdict, compute the chat's unread with `unreadForChats(deps.db, deps.config, archive, userId, new Map([[chatJid, scope]]))`.
   - The scope is `{ kind: 'dm', peer: chatJid.toLowerCase() }` for a DM, otherwise `{ kind: 'room', room: chatJid.toLowerCase() }`.
   - Add `unread` to the response when the count is a number ≥ 1.
   - Wrap it so a failure only omits `unread` and never fails the preview.
   - Keep the file at most 400 lines; if it would pass that, put the helper in a new `apps/server/src/push/preview-unread.ts`.
3. **`background.ts`:** for a chat notification, `post` sets `identifier: \`chat:${chatId}\``.
   - When the preview carried `unread`, also set `badge: unread` in the content.
   - The generic fallback, with no preview, uses the same identifier and no badge.
   - The test wake is unchanged.
4. **Tests:**
   - `apps/server/src/push/api-preview.test.ts`: one assertion that a preview for a chat with 2 unread messages returns `unread: 2`, if the existing harness seeds archive rows; otherwise assert the field is absent on failure and say so in your Report.
   - `apps/mobile/src/lib/push/background.test.ts`: one assertion that two wakes for the same chat schedule with the same `identifier` `chat:<id>`.

### Allowed files
- `packages/api-contract/src/push.ts`
- `apps/server/src/push/api-handlers.ts`
- `apps/server/src/push/preview-unread.ts`
- `apps/server/src/push/api-preview.test.ts`
- `apps/mobile/src/lib/push/background.ts`
- `apps/mobile/src/lib/push/background.test.ts`
- `work/T-1897-one-notification-per-chat.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push/api-preview.test.ts --reporter=dot
pnpm --filter @zilar/mobile exec vitest run src/lib/push/background.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **Each chat has at most one notification,** replaced by every new message, showing the newest line and the unread count when known.
- **Reply, Mark as read and tap** still dismiss it.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- `packages/api-contract/src/push.ts`: added an optional `unread: number` to `PushPreview` (T-1897 comment).
- `apps/server/src/push/api-handlers.ts`: after an `ok` verdict, builds the single chat's unread scope (`{ kind: 'dm', peer }` for a DM, otherwise `{ kind: 'room', room }`, both lower-cased JIDs), calls `unreadForChats` for that one chat, and adds `unread` to the response only when the count is a number ≥ 1. The read is wrapped so any failure (throw or rejection) resolves to no `unread` and the preview still answers 200. The file is 278 lines, so no `preview-unread.ts` was needed.
- `apps/mobile/src/lib/push/background.ts`: `post` now sets `identifier: chat:<chatId>` for every chat notification, preview success and generic fallback alike. It sets `badge: unread` only when the preview carried a count ≥ 1. The test wake still posts with `TEST_WAKE_IDENTIFIER` unchanged.
- `apps/mobile/src/lib/push/background.test.ts`: existing exact post assertions now include the new identifier; a new test posts two wakes for the same chat and asserts both use `chat:dm-1` and the second carries `badge: 2`.
- `apps/server/src/push/api-preview.test.ts`: the seed helper now accepts an optional archive timestamp; a new test seeds two recent DM rows and asserts the preview returns `unread: 2`.
- Dismissals need no change: Reply/Mark as read dismiss by `notification.request.identifier` (now `chat:<id>`), and reading in the app still dismisses by `data.chatId`.

### Checks run
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/push/background.test.ts`: 9 passed (1 file).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/api-preview.test.ts`: 8 passed (1 file).
- `pnpm gate` (repo root):
  ```
  PASS  format  (1.1s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.7s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/mobile  (1.0s)
  PASS  tests @zilar/server  (15.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- The unread test does not need a `chat_reads` row: both seeded rows are recent, so they sit above the 30-day floor of an unmarked chat. The existing harness does seed archive rows, so I asserted `unread: 2` rather than falling back to the "field absent" case.
- The generic fallback (no `messageId`, or a non-404 preview failure) sets `chat:<chatId>` and no badge as the spec says; that path is exercised by code inspection, not a dedicated test.
- `unread` is optional in the contract, so a new phone still talks to an older server and an older phone ignores the new field.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `7027dd610`.
- **The server:** the preview adds `unread` from `unreadForChats`, with a single-chat scope keyed by the already access-checked `verdict.message.chatJid`. A failure only omits the field.
- **The phone:** every chat notification posts as `chat:<chatId>` (the generic fallback too), with `badge` when the count is 1 or more, so a new message replaces the chat's notification. Reply / Mark as read dismiss by that identifier.
- **Tests:** one server and one phone test.
- **Live check** is with the next APK (plan task 6).

