---
id: T-1244
title: "TG-11 mark as unread, server + web: chat_prefs gains unread_mark (migration 0050); PUT chat prefs accepts unreadMark; reading the chat (PUT /chats/:jid/read) clears it on the server; web row menu 'Mark as unread' / 'Mark as read' and the list row shows an unread dot while the mark is set"
status: merged
milestone: M5
branch: task/T-1244-mark-as-unread-server-web
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1244: Mark as unread (server and web)

## Spec (written by Claude, do not edit)

### Why
It's item 11 of the Telegram parity fix plan (`docs/audit/telegram-parity-audit.md` §4): "Mark as unread". Telegram puts an unread dot on the chat until you open it, on every device.
- **Prefs:** per-user chat prefs live in `chat_prefs` (`apps/server/drizzle/0024_abandoned_skullbuster.sql`; the row type is at `apps/server/src/db/rows.ts:151`). The contract `ChatPref` and `PutChatPrefPayload` are in `packages/api-contract/src/chat-prefs.ts:39-48,84-91`, and the server is `apps/server/src/chat-prefs/service.ts` / `api.ts`.
- **The read mark:** stored by `putChatRead` (`apps/server/src/chats/reads.ts:36`).
- **Web:** the row menu is `apps/web/src/components/ChatActionsMenu.tsx` (Pin, Mute, Archive at `:59-90`), prefs effects are in `apps/web/src/store/effects/prefs.ts`, and the row is `apps/web/src/components/ChatListItem.tsx` (the unread badge at `:156-160`).

### What to build
1. **Migration** `apps/server/drizzle/0050_chat_prefs_unread_mark.sql`, hand-written like `0048_chat_reads.sql`: `ALTER TABLE "chat_prefs" ADD COLUMN "unread_mark" boolean DEFAULT false NOT NULL;`. Update `rows.ts:151` to match.
2. **Contract:** `ChatPref.unreadMark: Schema.optional(Schema.Boolean)` (optional, so older rows decode), and `PutChatPrefPayload.unreadMark: Schema.optional(Schema.Boolean)`.
3. **Server:**
   - the prefs PUT writes `unread_mark`, and the list returns it;
   - **`putChatRead` also clears it**, in the same `runSql`: `UPDATE chat_prefs SET unread_mark = false, updated_at = now() WHERE user_id = … AND chat_jid = … AND unread_mark`. Opening the chat on any device clears the mark for all.
4. **Web:**
   - **The menu:** in `ChatActionsMenu.tsx`, add "Mark as unread" when the chat has `unread === 0` and no mark, or "Mark as read" when it has unread messages or the mark is set, with lucide `MailOpen` / `Mail` icons.
     - "Mark as unread" sets the pref through the prefs effect.
     - "Mark as read" calls the existing read path (the store's `recordRead` / the HTTP read mark; cite it) and clears the pref.
   - **The row** shows the unread badge as a plain dot (no count) when `unreadMark` is set and `unread === 0`. Muted chats keep their muted badge style.
   - **Opening the chat** clears the mark locally at once, and the server clears it through the read mark.
   - Keep every touched file at most 400 lines.
5. **Mock backend:** prefs accept and return `unreadMark` (`packages/mock-backend/src/domains/chat-prefs/`).
6. **Tests** (permissions), up to 2, in a new `apps/server/src/chat-prefs/unread-mark.test.ts` (there's no chat-prefs test file yet; follow `apps/server/src/chats/reads.test.ts`):
   - setting `unreadMark` and then `putChatRead` leaves it `false`;
   - another user's pref is untouched.

### Out of scope
Mobile: the next task, once this merges.

### Read first
`AGENTS.md`, `apps/server/drizzle/0048_chat_reads.sql`, `apps/server/src/db/rows.ts:140-170`, `packages/api-contract/src/chat-prefs.ts`, `apps/server/src/chat-prefs/service.ts`, `apps/server/src/chat-prefs/api.ts`, `apps/server/src/chats/reads.ts`, `apps/web/src/components/ChatActionsMenu.tsx`, `apps/web/src/components/ChatListItem.tsx` and `apps/web/src/store/effects/prefs.ts`.

### Allowed files
`apps/server/drizzle/0050_chat_prefs_unread_mark.sql`, `apps/server/src/db/rows.ts`, `packages/api-contract/src/chat-prefs.ts`, `apps/server/src/chat-prefs/**`, `apps/server/src/chats/reads.ts`, `apps/web/src/components/ChatActionsMenu.tsx`, `apps/web/src/components/ChatListItem.tsx`, `apps/web/src/store/**`, `apps/web/src/lib/api/**`, `packages/chat-core/src/types.ts`, `packages/client-core/src/store/prefs.ts`, `packages/mock-backend/src/domains/chat-prefs/**`, `work/T-1244-mark-as-unread-server-web.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/chat-prefs --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, and every touched file stays at most 400 lines.
- **The lead's checks:**
  - on the local web mock, Mark as unread shows the dot, and opening the chat clears it;
  - after deploy, `/api/chat-prefs` answers 200 (read-only).

---

## Report (written by the worker when done)

### What I did

- **Migration:** added `apps/server/drizzle/0050_chat_prefs_unread_mark.sql` (`ALTER TABLE "chat_prefs" ADD COLUMN "unread_mark" boolean DEFAULT false NOT NULL;`), hand-written like `0048`. It is the highest file, so the migrator applies it after `0049`. No journal edit (0047–0049 are not in `meta/_journal.json` either).
- **Row + contract:** `ChatPrefRow.unreadMark: boolean` in `apps/server/src/db/rows.ts`; `ChatPref.unreadMark` and `PutChatPrefPayload.unreadMark` are `Schema.optional(Schema.Boolean)` in `packages/api-contract/src/chat-prefs.ts`.
- **Server:** `putChatPref` reads/writes `unread_mark` (INSERT column + `ON CONFLICT` update) and the all-defaults delete test now also requires `unreadMark === false`; the view returns it; the API handler passes `request.payload.unreadMark`.
- **Read mark:** `putChatRead` (`apps/server/src/chats/reads.ts`) now runs one `runSql` that first `UPDATE chat_prefs SET unread_mark = false, updated_at = now() WHERE user_id = … AND chat_jid = … AND unread_mark` and then the existing forward-only `INSERT … ON CONFLICT … WHERE`. The old pre-read + early return was removed because the `ON CONFLICT` `WHERE` already enforces forward-only, and the early return would have skipped the clear for an equal/older mark (e.g. mark unread after reading: the read mark cannot move forward, yet opening must clear the dot).
- **Contract type for the row:** `ChatSummary.unreadMark?: boolean` in `packages/chat-core/src/types.ts`.
- **Web:** menu item in `ChatActionsMenu.tsx` — "Mark as read" (`MailOpen`) when `chat.unread > 0 || chat.unreadMark`, else "Mark as unread" (`Mail`). "Mark as unread" calls the new `setUnreadMark(chat.id, true)`; "Mark as read" calls the new store action `markChatRead(chat.id)`, which runs the shared `recordRead` (local count clear + `PUT /api/chats/:jid/read` via `markChatRead` in `lib/api/chats.ts`) and then clears the pref. Row dot (plain, no count) in `ChatListItem.tsx` when `unread === 0 && unreadMark` (muted chats use `bg-badge-muted`, else `key-primary`). `openChat` clears the mark locally at once and, when a mark was set, also PUTs `unreadMark: false`.
- **Mock backend:** `chat-prefs` routes accept/validate/return `unreadMark` and include it in the all-defaults delete test.

### Files changed

`apps/server/drizzle/0050_chat_prefs_unread_mark.sql` (new), `apps/server/src/db/rows.ts`, `packages/api-contract/src/chat-prefs.ts`, `apps/server/src/chat-prefs/service.ts`, `apps/server/src/chat-prefs/api.ts`, `apps/server/src/chat-prefs/unread-mark.test.ts` (new), `apps/server/src/chats/reads.ts`, `packages/chat-core/src/types.ts`, `apps/web/src/components/ChatActionsMenu.tsx`, `apps/web/src/components/ChatListItem.tsx`, `apps/web/src/lib/api/chats.ts`, `apps/web/src/store/store.ts`, `apps/web/src/store/effects/prefs.ts`, `apps/web/src/store/effects/history.ts`, `apps/web/src/store/effects/chatActions.ts`, `apps/web/src/store/effects/lifecycle.ts`, `apps/web/src/store/effects/groupCreate.ts`, `packages/mock-backend/src/domains/chat-prefs/routes.ts`, `work/T-1244-mark-as-unread-server-web.md`.

Every touched file is at most 400 lines (`store.ts` is exactly 400).

### Tests

New `apps/server/src/chat-prefs/unread-mark.test.ts` (2 tests): (1) `unreadMark: true` then `PUT /api/chats/:jid/read` leaves it `false`; (2) a second user's row for the same `chat_jid` stays `true` (the clear is scoped by `user_id`). UI code has no tests (per AGENTS).

### Commands I ran

- `pnpm install` — Done.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chat-prefs` — 1 file, 2 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chats/reads.test.ts` — 1 file, 8 tests passed (reads unchanged in behaviour).
- `pnpm --filter @zilar/server exec vitest run src/chat-prefs --reporter=dot` (the pinned Check) — 1 file, 2 tests passed.
- `pnpm gate` (from repo root) — summary:
  ```
  gate: 19 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (0.6s)
  PASS  lint  (0.8s)
  PASS  typecheck  (5.9s)
  PASS  effect  (1.1s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/chat-core  (1.3s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/server  (11.9s)
  PASS  tests @zilar/web  (6.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Deviations from the spec

1. I did not edit `packages/chat-core/src/chat-prefs.ts` (the `applyChatPrefs` mapper): it is outside this task's Allowed files (only `packages/chat-core/src/types.ts` is listed there), and `pnpm gate` flags any file outside scope. Instead I added `applyPrefsWithUnreadMark` in `apps/web/src/store/effects/prefs.ts` and used it at every web site that applies prefs (`paint`, boot `applyBoot`, group create `repaintCreatedGroup`, `refreshChats`). The field itself (`ChatSummary.unreadMark`) is in the allowed `types.ts`.
2. Opening a chat: the spec says the server clears the mark "through the read mark". `openChat` does that (via `recordRead`), but also sends `PUT /api/chat-prefs/:jid { unreadMark: false }` when a mark was set. Reason: the shared mock backend's read route does not clear the pref, and a fresh device holds no numeric last-read id, so the read-mark path alone would leave the dot to come back on the next list refresh. The extra PUT is idempotent and only fires while a mark is set.
3. `putChatRead` lost its pre-read/early-return (see above); the forward-only rule now lives only in the `ON CONFLICT … WHERE`, which was already described as the atomic guard.

### Open questions

None. Mobile is out of scope (the server returns `unreadMark` in `/api/chat-prefs`; mobile can map it in the next task).

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (1 nit, 2 follow-ups).**
- **Migration 0050:** `chat_prefs.unread_mark boolean DEFAULT false NOT NULL`, with `rows.ts` updated.
- **Server:** the prefs PUT and list carry `unreadMark`. `putChatRead` clears the mark first, then writes the read mark forward-only through the INSERT's `WHERE`; the SELECT pre-check is gone, so an older read still clears a manual mark.
- **Web:** the row menu offers "Mark as unread" or "Mark as read", and the row shows a dot while the mark is set.
- **Lead's check on the local web mock:** Marta's menu shows "Mark as unread"; choosing it puts a white dot on the row, and opening the chat clears the dot.
- **Follow-ups:**
  - share the `unreadMark` mapping in chat-core `applyChatPrefs` for mobile;
  - make the mock's read route clear the mark like the server.
- **Next:** mobile.
