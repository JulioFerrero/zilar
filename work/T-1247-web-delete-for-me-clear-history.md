---
id: T-1247
title: "TG-7 DMs, web + client-core: 'Delete for me' on any message in a DM (own messages also keep 'Delete for everyone'), and 'Clear history' in the DM's chat menu, on the T-1236 routes; client-core removes the rows locally after the server says yes"
status: merged
milestone: M5
branch: task/T-1247-web-delete-for-me-clear-history
model: auto
effort: default
depends_on: [T-1236]
estimate: 0.4 day
---

# T-1247: Delete for me and Clear history (web)

## Spec (written by Claude, do not edit)

### Why
It's item 7 of the Telegram parity fix plan (`docs/audit/telegram-parity-audit.md` §4). T-1236 (merged and live, after Julio's GRANT) added the routes:
- `clearHistory`, the DELETE `/chats/:jid/history`;
- `deleteForMe`, the DELETE `/chats/:jid/messages/:archiveId`.

Both work on DMs only and only on the caller's own copy (`packages/api-contract/src/chats.ts:145-160`). The web has only "Delete for everyone" today: `MessageMenu.tsx:140-150` opens a confirm that calls `deleteForEveryone`, and `canDeleteMessage` (`MessageBubble.tsx:165`) allows it only on your own messages.

### What to build
1. **Ports and client-core:**
   - add the optional `deleteMessageForMe?(jid, archiveId)` and `clearChatHistory?(jid)` to `packages/client-core/src/store/ports.ts`, and wire them on web next to `markChatRead` (`apps/web/src/lib/api/chats.ts:87`, plus `apps/web/src/store/effects/ports.ts`);
   - a new `packages/client-core/src/store/delete-own.ts`:
     - **`deleteForMe(ctx, chatId, messageId)`:** find the message's archive id (its `id` when numeric, else through `ctx.k.wireTargetFor`, the same lookup as `delivered.ts` `archiveIdOf`; reuse it). With no archive id, do nothing and return `'unavailable'`. Call the port, and **on success** remove the message from `messagesByChat[chatId]`. If it was the chat's `lastMessage`, set the preview to the newest remaining message, or none. A failure returns `'failed'` and changes nothing.
     - **`clearHistory(ctx, chatId)`:** call the port, and on success set `messagesByChat[chatId] = []`, clear the chat's `lastMessage` and set `unread` to 0. Leave the chat row in the list, as Telegram does.
   - add both to the web store (`apps/web/src/store/store.ts`, 397 lines; must stay at most 400) and `apps/web/src/store/effects/chatActions.ts`.
2. **Web menus:**
   - **`MessageMenu.tsx`, in a DM** (the chat kind is `dm` and not an AI chat; cite where the kind is read), offers a delete action on **every** message that isn't deleted or still sending.
     - On my own message, the confirm offers "Delete for everyone" and "Delete for me".
     - On the other person's message, the confirm offers "Delete for me" only, with the body "This removes it from your chat only. {Name} still has it."
     - In groups nothing changes.
   - **`ChatActionsMenu.tsx`, DM only:** "Clear history" with lucide `Eraser`, behind a confirm: "Clear your history with {Name}? This removes every message from your side only. {Name} keeps theirs."
   - A failure shows one line ("Could not delete. Try again.").
   - Keep every touched file at most 400 lines.
3. **Mock backend:** answer 204 on both routes and drop the rows from the mock store, so the mock flow works (`packages/mock-backend/src/domains/chats/`).
4. **Tests** (message pipeline), in a new `packages/client-core/src/store/delete-own.test.ts` following `delivered.test.ts`, up to 3:
   - `deleteForMe` calls the port with the archive id and removes the row on success, and keeps it on failure;
   - a message with no archive id makes no call;
   - `clearHistory` empties the chat and clears the preview.

### Out of scope
- Mobile: the next task.
- Other devices of the same user still show the messages until their next history load. Note it in the Report.

### Read first
`AGENTS.md`, `work/T-1236-dm-clear-history-delete-for-me-server.md` (the Report and the Review), `packages/api-contract/src/chats.ts:140-165`, `packages/client-core/src/store/delivered.ts`, `packages/client-core/src/store/ports.ts`, `apps/web/src/components/message/MessageMenu.tsx`, `apps/web/src/components/MessageBubble.tsx:150-170`, `apps/web/src/components/ChatActionsMenu.tsx`, `apps/web/src/store/effects/chatActions.ts` and `apps/web/src/store/store.ts`.

### Allowed files
`packages/client-core/src/store/delete-own.ts`, `packages/client-core/src/store/delete-own.test.ts`, `packages/client-core/src/store/ports.ts`, `packages/client-core/src/store/delivered.ts`, `packages/client-core/src/store/index.ts`, `apps/web/src/lib/api/chats.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/store/effects/ports.ts`, `apps/web/src/store/effects/chatActions.ts`, `apps/web/src/store/store.ts`, `apps/web/src/components/message/MessageMenu.tsx`, `apps/web/src/components/MessageBubble.tsx`, `apps/web/src/components/ChatActionsMenu.tsx`, `apps/web/src/components/ConfirmDialog.tsx`, `apps/web/src/components/MessageActionsMenu.tsx` (added by the lead for fix round 3's label), `packages/mock-backend/src/domains/chats/**`, `work/T-1247-web-delete-for-me-clear-history.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/delete-own.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass, and every touched file stays at most 400 lines.
- **The lead's check on the local web mock:**
  - "Delete for me" on Ana's message removes it;
  - "Clear history" empties the chat and keeps the row.

---

## Report (written by the worker when done)

Done. Delete-for-me on any message in a DM and clear-history in the DM chat menu, on the T-1236 routes, on web + client-core + the mock backend. `pnpm gate` is green and every changed file is inside the Allowed files; `store.ts` and `effects/ports.ts` are at exactly 400 lines.

### What I built
- **`packages/client-core/src/store/delete-own.ts`** (new, 110 lines): `deleteForMe(ctx, chatId, messageId)` and `clearHistory(ctx, chatId)`, both `Effect<DeleteOutcome>` (`'deleted' | 'unavailable' | 'failed'`).
  - `deleteForMe` finds the stored message (alias-aware), gets its archive id, and if the API port has `deleteMessageForMe` calls it; **only on success** removes the row and, when it was the preview, moves `lastMessage` to the newest remaining message (or none). No id → `'unavailable'`, no call. A rejection → `'failed'`, no change, plus the one error line.
  - `clearHistory` calls the port; on success sets `messagesByChat[chatId] = []`, clears the chat's `lastMessage` and `unread` to 0, and keeps the row.
- **`packages/client-core/src/store/ports.ts`**: optional `deleteMessageForMe?(jid, archiveId)` and `clearChatHistory?(jid)` on `CoreApi`.
- **`packages/client-core/src/store/delivered.ts`**: `archiveIdOf` is now exported so delete-own reuses the same lookup.
- **`packages/client-core/src/store/index.ts`**: `export * from './delete-own'`.
- **Web wiring**: `lib/api/chats.ts` `deleteMessageForMe`/`clearChatHistory` (DELETE the two routes), re-exported from `lib/api.ts`; `store/effects/ports.ts` `ApiClient` + `realApi`; `store/effects/chatActions.ts` `deleteForMe`/`clearHistory` actions (fire-and-forget like `deleteForEveryone`); `store/store.ts` interface methods.
- **`MessageMenu.tsx`**: reads the chat kind in a selector (`chat?.kind === 'dm' && chat.isAI !== true`) and the viewer id; in a DM every non-deleted, non-sending message enables the delete entry. Confirm: my own message → "Delete for everyone" + "Delete for me"; the peer's message → "Delete for me" only with body "This removes it from your chat only. {Name} still has it."; a group keeps the old confirm.
- **`ConfirmDialog.tsx`**: optional `secondLabel`/`onSecond` for the two-choice DM confirm.
- **`ChatActionsMenu.tsx`** (`ChatPrefMenuItems`, so it shows in both the row menu and the header menu): DM-only "Clear history" with lucide `Eraser`, behind a confirm whose body is the spec sentence. The chat row is kept.
- **Mock backend** (`packages/mock-backend/src/domains/chats/routes.ts`): `DELETE /chats/:jid/history` and `DELETE /chats/:jid/messages/:archiveId` answer 204 and drop the rows from the live `data.messages` table (the fake XMPP history reads the same table, so a reload stays cleared).
- **Tests**: new `packages/client-core/src/store/delete-own.test.ts` (3 tests, following `delivered.test.ts`): (1) the port gets the archive id and the row+preview go on success while a rejection keeps the row and sets the one error line; (2) a message with no archive id makes no call; (3) clear history empties the chat, clears the preview and the unread count, and keeps the row.

### Deviations / decisions (please read)
1. **Archive-id fallback for the mock.** The spec says reuse `delivered.ts` `archiveIdOf`; that returns a value only for a numeric archive id. The mock seeds message ids as slugs (`ana-1`, …), so a strict reuse would make "Delete for me" a no-op on the mock and fail the acceptance. I use `archiveIdOf(ctx, message) ?? ctx.k.wireTargetFor(message.id)`: the real server still receives the numeric archive id in practice, and the mock receives its slug, so both flows work. A `local-*` message (never acked) still answers `unavailable`.
2. **Menu label.** `MessageActionsMenu.tsx` is **not** in the Allowed files and hardcodes the entry label "Delete for everyone". In a DM the entry is now enabled for the peer's messages too, so it still reads "Delete for everyone"; the confirm then correctly offers "Delete for me" only. If the lead wants a generic "Delete" label in DMs, `apps/web/src/components/MessageActionsMenu.tsx` has to be added to the Allowed files (I did not touch it).
3. **Clear-history failure line.** The fixed sentence is set on the store's `actionError`, which the open chat's composer renders (same mechanism as `deleteForEveryone`). Triggered from a list row with no chat open, there is no composer mounted, so the line is not visible there. The happy path (the acceptance) is unaffected.
4. **Out of scope (per the spec):** other devices of the same user keep showing the messages until their next history load.

### Checks (real results)
- `pnpm --filter @zilar/client-core exec vitest run src/store/delete-own.test.ts --reporter=dot`: **1 file, 3 passed** (`Duration 1.31s`).
- `pnpm gate` (run from the repo root):
  ```
  gate: 15 changed file(s) against main
  PASS  install (frozen)  (2.2s)
  PASS  format  (1.6s)
  PASS  lint  (1.0s)
  PASS  typecheck  (5.4s)
  PASS  effect  (1.7s)
  PASS  tests @zilar/client-core  (10.7s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  PASS  tests @zilar/web  (16.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  (The first gate run failed on prettier for three files; I ran `prettier --write` on them and the run above is the second.)
- Line budget: every touched file is ≤ 400 (`store.ts` 400, `store/effects/ports.ts` 400, `MessageMenu.tsx` 188, `ChatActionsMenu.tsx` 190, `ConfirmDialog.tsx` 61, `delete-own.ts` 110, mock `routes.ts` 75).

### Security checklist
- Deletes are scoped by the three-part server route (caller localpart + bare peer, and the archive id for the single message); the web only calls the two DELETE routes, and the local removal happens after the server answers 204.
- No secrets or tokens are logged; no request-body logging added.
- No new route or permission path was added (T-1236 already covers them); this task is web/client-core/mock only.

### Round (fix round 1)

Findings from `PREREVIEW.md`:

- **Finding 1 (should-fix) — fixed.** Clear-history from the chat-list row menu is no longer silent. `clearHistory` in the web store now resolves with the core outcome (`rt.runPromise(clearHistoryCore(...))`), so a caller can await it; `ChatActionsMenu`'s confirm awaits it, sets the menu's own `error` line to the fixed sentence (`Could not delete. Try again.`) when the outcome is `'failed'`, and the row-menu wrapper keeps the menu open on failure (`onDone={(failed) => !failed && onClose()}`, the rule the header menu already used) so the line is visible. Files: `apps/web/src/components/ChatActionsMenu.tsx`, `apps/web/src/store/effects/chatActions.ts`, `apps/web/src/store/store.ts`.
- **Finding 2 (should-fix) — fixed.** `dropThread`/`dropMessage` no longer write into `data.messages`. That map is the messages domain's live getter over the seed's own map (`domains/messages/state.ts:12`), so an in-place write mutated the shared seed and leaked across `reset()`. The drops now swap in a private map and repoint `appendMessage` (the fake XMPP's write path) at it — replace instead of mutate, the move `appendMessage` itself makes (`domains/messages/state.ts:16`). File: `packages/mock-backend/src/domains/chats/routes.ts`.
- Findings 3-5 (nits) and follow-up F-A: left as is, per the fix-round rules.

Tests added:

- `packages/mock-backend/src/domains/chats/routes.test.ts` (new, 2 tests): a backend built from an explicit shared `seed` clears a thread and drops one message; the caller's `seed.messages` is untouched and `reset()` restores the rows. Both tests fail on the old in-place code.
- `packages/client-core/src/store/delete-own.test.ts`: added the `clearHistory` failure case (port rejects → `'failed'`, the one error line is set, the chat is kept), the outcome the row menu now branches on.

Checks (real results):

- `pnpm --filter @zilar/client-core exec vitest run src/store/delete-own.test.ts --reporter=dot`: **1 file, 4 passed**.
- `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/domains/chats/routes.test.ts`: **1 file, 2 passed**.
- `pnpm gate` (from the repo root):
  ```
  gate: 16 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.5s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.5s)
  PASS  effect  (1.5s)
  PASS  tests @zilar/client-core  (11.9s)
  PASS  tests @zilar/mock-backend  (5.4s)
  PASS  tests @zilar/web  (7.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- Line budget: every touched file is ≤ 400 (`store.ts` 400, `ChatActionsMenu.tsx` 200, `chatActions.ts` 244, `delete-own.test.ts` 128, mock `routes.ts` 99, `routes.test.ts` 52).

### Fix round 3 (lead)

**Item 1 — "Delete for me" removes two messages.** I could not reproduce it against this code. Traced the exact repro (`marta@zilar.test`, `mar-1`/`mar-2`/`mar-3`) on the real mock backend at three levels:

- Full UI (real store + real mock, `MessageList` + the bubble menu + `ConfirmDialog`): before `[mar-1, mar-2, mar-3]`, after `[mar-1, mar-2]`.
- The store (instrumented `deleteForMe`): `messageId='mar-3'`, `foundId='mar-3'`, `archiveId='mar-3'`, `wireTargetFor('mar-3')='mar-3'`, list `[mar-1, mar-2, mar-3]`.
- The mock: `DELETE /chats/marta@zilar.test/messages/mar-3` → 204, table `[mar-1, mar-2]`. Re-opening the chat (a fresh history merge) kept `[mar-1, mar-2]`.

The only way the server and the store can act on **two** rows is an id mismatch, so I hardened that path: `deleteForMe` now resolves the clicked message by its **exact id first** (alias-aware lookup after), and names that same row to the server — `archiveIdOf(...) ?? message.id`, still `undefined` for a `local-*` id so "no archive id → no call" holds — instead of `wireTargetFor(message.id)`, which can resolve to an alias/server id. The mock already removes by that id (`routes.ts:83`), so both sides name the one row.

- Tests: `delete-own.test.ts` — three messages, deleting the last leaves the first two (and the port is called with `mar-3`); `routes.test.ts` — `DELETE mar-3` leaves `mar-1, mar-2`.

**Item 2 — label.** The item's label was hardcoded in `apps/web/src/components/MessageActionsMenu.tsx:94-95` ("Delete for everyone"). Added a `deleteLabel` prop; `MessageMenu.tsx` passes `isDm ? (own ? 'Delete' : 'Delete for me') : 'Delete for everyone'`. Groups (and AI DMs, which are not `isDm`) keep the old label.

Checks (real results):

- `pnpm --filter @zilar/client-core exec vitest run src/store/delete-own.test.ts --reporter=dot`: **1 file, 5 passed**.
- `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/domains/chats/routes.test.ts`: **1 file, 3 passed**.
- `pnpm gate` (from the repo root):
  ```
  gate: 17 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.1s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/client-core  (3.6s)
  PASS  tests @zilar/mock-backend  (1.0s)
  PASS  tests @zilar/web  (3.7s)
  scope: 1 file(s) outside the Allowed files:
    apps/web/src/components/MessageActionsMenu.tsx
  migration: every added migration continues from the base
  GATE PASS
  ```
  Scope note: the delete item's label lives only in `MessageActionsMenu.tsx`, which the task's Allowed files do not list; item 2 needs it, so it is the one file outside scope (the gate still ends GATE PASS).

### Rebase onto T-1248

Resolved the conflict in `packages/mock-backend/src/domains/chats/routes.ts`: kept T-1248's `PUT /chats/:jid/read` (with `clearUnreadMark`) and T-1247's replace-not-mutate `dropThread`/`dropMessage`.

- `pnpm --filter @zilar/mock-backend exec vitest run src/domains/chats/routes.test.ts --reporter=dot`: **1 file, 2 passed**.
- `store.ts` was 403 lines after the T-1248 merge (its base is exactly 400); tightened the adjacent `deleteForEveryone` comment to one line (doc only), back to **400**.
- `pnpm gate` (from the repo root):
  ```
  gate: 17 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.5s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/client-core  (3.7s)
  PASS  tests @zilar/mock-backend  (1.1s)
  PASS  tests @zilar/web  (4.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

## Review (written by Claude)

**Lead, 2026-10-12: approved after 3 rounds. Final pre-review clean (3 nits, 1 follow-up: the out-of-scope file, now allowed by the lead).**
- **Round 3 came from the lead's mock check.** Delete for me on `mar-3` also hid `mar-2`, and the menu item read "Delete for everyone" on the other person's message.
  - The worker couldn't reproduce the double removal, but made `deleteForMe` resolve the exact clicked id first and name that same row to the server.
  - It added tests on both layers (client-core `delete-own` 5 passed, mock `routes` 3 passed).
  - The label now comes through `MessageActionsMenu`'s `deleteLabel`.
- **Lead's re-check on the local web mock (Marta DM):**
  - the menu on Marta's message reads "Delete for me", and its confirm says "This removes it from your chat only. Marta still has it.";
  - confirming leaves `[mar-1, mar-2]`, still the same 3 s later;
  - on my own message the menu reads "Delete", and its confirm offers "Delete for me" and "Delete for everyone";
  - the chat menu has Clear history.
- **Note:** other devices of the same user keep the messages until their next history load (out of scope by the spec).
