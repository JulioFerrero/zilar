---
id: T-1893
title: "Notification Mark as read, server side (plan task 2): the push preview also returns archiveId; PUT /api/chats/:jid/read takes an optional displayed origin id and, after storing the mark, sends the XEP-0333 <displayed> as the caller through send_stanza (best effort)"
status: merged
milestone: M5
branch: task/T-1893-notification-read-ids
model: auto
effort: default
depends_on: [T-1889]
estimate: 35 min
---

# T-1893: Mark as read from a notification, server side (plan task 2)

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/notification-actions.md` §2 "Read marker" and §6 task 2** (Julio approved the feature on 2026-10-17). A notification's Mark as read action runs headless with no XMPP connection. To match an in-app read it must:
- store the caller's read mark (the archive id);
- send the `<displayed>` marker (the origin id) so the sender sees the read tick.

The notification needs both ids, so the push preview must return the archive id too.

### Facts (read by the lead on 2026-10-17)
- **`PushPreview`** is `{ title, body, chatId }` (`packages/api-contract/src/push.ts:62-66`). The preview query's `messageId` is the origin id (`:71-73`).
- **The preview handler** (`apps/server/src/push/api-handlers.ts`, 254 lines): it reads the archive `row` (`:166`, an `ArchiveCandidate` with `timestamp: number | string | bigint`, `apps/server/src/push/archive-scan.ts:22-31`) and returns `{ title, body, chatId }` (`:221-226`). Its tests are in `apps/server/src/push/api-preview.test.ts`.
- **`markRead`:** `PUT /chats/:jid/read`, payload `{ messageId }` (the archive id) (`packages/api-contract/src/chats.ts:150-156`).
- **`markReadFor`** (`apps/server/src/chats/mark-handlers.ts:46-64`): access → limiter → `putChatRead`.
- **Sending as the caller:**
  - `apps/server/src/chats/reply-handler.ts` (T-1889) has the pattern: `kindFor(bare, mucDomain)` at `:55-57` (module-private), `jidFor(localpartFor(user.id), domain)` at `:195`, and `deps.adminClient.sendStanza(callerBare, bare, stanza)` at `:198`;
  - `buildDisplayed({ chatJid, kind, messageId })` is `packages/xmpp-core/src/stanza/build-control.ts:50-60`. It is not exported from `packages/xmpp-core/src/index.ts`; `buildMessage` was exported there by T-1889.
- **Existing read-mark tests:** `apps/server/src/chats/read-marks.test.ts` (68 lines).

### Steps
1. **`push.ts`:** add `archiveId: Schema.optional(Schema.String)` to `PushPreview`, with a T-1893 comment ("the row's archive id, for a notification's Mark as read"). It's optional, so new phones still read older servers.
2. **`api-handlers.ts`:** return `archiveId: String(row.timestamp)` with the preview. Keep the file at most 400 lines.
3. **`chats.ts`:** `markRead`'s payload gains `displayed: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)))`, with a T-1893 comment.
4. **`xmpp-core` `index.ts`:** export `buildDisplayed` next to `buildMessage`.
5. **`reply-handler.ts`:** export `kindFor` (no other change), so both handlers share it.
6. **`mark-handlers.ts` `markReadFor`:** after `putChatRead` succeeds, if `request.payload.displayed` is set and `deps.adminClient` exists:
   - send `buildDisplayed({ chatJid: bare, kind: kindFor(bare, mucDomain), messageId: displayed }).toString()` with `sendStanza(callerBare, bare, …)`;
   - **best effort:** await it in a try/catch that logs `{ userId, chatJid }` with `'read marker send failed'` and still answers 204. Without `displayed` or without an admin client, nothing is sent;
   - widen `MarkReadRequest.payload` accordingly.
7. **Tests:** add to `read-marks.test.ts`, or a new `apps/server/src/chats/mark-displayed.test.ts` if that file's harness doesn't fit:
   - with `displayed`, one `sendStanza` from the caller's bare JID containing `<displayed` and the id;
   - without it, none;
   - a throwing `sendStanza` still gives 204 and the mark is stored.

   In `api-preview.test.ts`, add one assertion that an ok preview carries `archiveId`.

### Allowed files
- `packages/api-contract/src/push.ts`
- `packages/api-contract/src/chats.ts`
- `packages/xmpp-core/src/index.ts`
- `apps/server/src/push/api-handlers.ts`
- `apps/server/src/push/api-preview.test.ts`
- `apps/server/src/chats/mark-handlers.ts`
- `apps/server/src/chats/reply-handler.ts`
- `apps/server/src/chats/read-marks.test.ts`
- `apps/server/src/chats/mark-displayed.test.ts`
- `work/T-1893-notification-read-ids.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/chats/read-marks.test.ts src/push/api-preview.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **The preview returns `archiveId`.**
- **A read with `displayed`** stores the mark and sends `<displayed>` as the caller. A failed send never fails the read.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- `packages/api-contract/src/push.ts`: added optional `archiveId` to `PushPreview` with a T-1893 comment.
- `apps/server/src/push/api-handlers.ts`: an ok preview now also returns `archiveId: String(row.timestamp)`.
- `packages/api-contract/src/chats.ts`: `markRead`'s payload gained optional `displayed` (1–256 chars) with a T-1893 comment.
- `packages/xmpp-core/src/index.ts`: exported `buildDisplayed` next to `buildMessage`.
- `apps/server/src/chats/reply-handler.ts`: exported `kindFor` (no other change).
- `apps/server/src/chats/mark-handlers.ts`: after `putChatRead` succeeds and when both `displayed` and `deps.adminClient` exist, sends `buildDisplayed(...)` with `sendStanza(callerBare, bare, …)` as the caller. Wrapped in try/catch: a failed send logs `{ userId, chatJid }` with `'read marker send failed'` and the read still answers 204. `MarkReadRequest.payload` widened; `displayed?: string | undefined` matches the decoded optional field under `exactOptionalPropertyTypes`.
- `apps/server/src/chats/mark-displayed.test.ts` (new): with `displayed` stores the mark and sends one stanza from the caller's bare JID containing `<displayed` and the id; without it sends nothing; a throwing `sendStanza` still answers 204, stores the mark and logs `read marker send failed`.
- `apps/server/src/push/api-preview.test.ts`: the ok preview now asserts `archiveId` equals the seeded row timestamp. Three exact `toEqual` preview assertions became `toMatchObject` because the response gained `archiveId` (the two unrelated preview tests at the generic-body and card cases).

### Checks run

- `pnpm install`: done (16.7s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chats/read-marks.test.ts src/chats/mark-displayed.test.ts src/push/api-preview.test.ts`: 3 test files passed, 11 tests passed.
- `pnpm gate` (after fixing the prettier complaint in the new test file and the `exactOptionalPropertyTypes` type error):
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (0.6s)
  PASS  lint  (0.6s)
  PASS  typecheck  (8.0s)
  PASS  effect  (1.2s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/server  (37.0s)
  PASS  tests @zilar/xmpp-core  (1.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- No deviations from the spec. The read route reuses `kindFor` from `reply-handler.ts` as instructed, so a group read keeps `type="groupchat"`.
- Sending the marker is awaited after the mark write (best effort, as specified). It adds one `send_stanza` round trip to a read with `displayed`; a request without it is unchanged.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `c64cf8a27`.
- **The preview** returns `archiveId` (`String(row.timestamp)`), optional in the contract.
- **`markRead`** takes an optional `displayed` (1..256). After `putChatRead` it sends `buildDisplayed` as the caller's bare JID; a failure is logged with ids only and still answers 204.
- **Shared code:** `kindFor` is shared with the reply route, and `buildDisplayed` is exported from xmpp-core.
- **Tests:** 3 new tests, plus a preview assertion.
- **Next:** notification phone task 3, the categories and the reply/read handlers in the wake task.
