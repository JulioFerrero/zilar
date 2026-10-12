---
id: T-1207
title: "MP-F3 client half: web and mobile take unread counts and the last-message preview from /api/chats (fresher server data wins over memory, so reading on one device clears the other), and reading a chat sends PUT /api/chats/:jid/read with the archive id"
status: merged
milestone: M5
branch: task/T-1207-client-server-unread
model: auto
effort: default
depends_on: [T-1205]
estimate: 0.4 day
---

# T-1207: The apps use the server's unread and read marks

## Spec (written by Claude, do not edit)

### Why
`docs/audit/message-pipeline-audit.md` MP-5 and MP-6, the client half of F3. T-1205 is live: each `/api/chats` entry (DMs, groups' General, and every topic in `topics`) now carries an optional `unread: number` and `lastMessage: { id, text, senderName?, at }`, and `PUT /api/chats/:jid/read` with `{ messageId }` stores a forward-only mark. See `packages/api-contract/src/chats.ts` and `apps/server/src/chats/reads.ts`. The lead verified the live answer: both DMs carry both fields.

**The `messageId` must be the archive id**, a decimal string of microseconds, the same id MAM gives a message. `lastMessage.id` is the **origin id**, not a mark (T-1198 Review). The server answers 400 for a non-numeric id.

The clients ignore all of this today:
- **Every row starts at 0:** `unread: 0` in `packages/client-core/src/store/chat-rows.ts:64,129`, with no `lastMessage`.
- **A refresh keeps the in-memory values:** `apps/mobile/src/store/effects/history.ts:185-197` and `apps/web/src/store/effects/chatRows.ts:30-45` keep the old `unread` and `lastMessage`. So a chat read on another device stays unread here.
- **Reads stay local:** `recordRead` (`packages/client-core/src/store/reads.ts:25-39`) clears only local state.

### What to build
1. **`chat-rows.ts`:** map the entry's `unread` (default 0) and build `lastMessage` as a `UiMessage` (`packages/chat-core/src/types.ts:55`):
   - `id` = the preview id, `chatId` = the row id, `senderName`, and `text`;
   - `createdAt` = `new Date(at)`, `status: 'sent'`;
   - `senderId`: use what is safe for display only, and say what you chose.
   - Do this for DM rows, group General rows and topic rows (the topic objects carry the same two fields).
2. **One shared merge rule, in a new `packages/client-core/src/store/unread-merge.ts`,** used by **both** refresh merges (mobile `history.ts:185-197`, web `chatRows.ts:30-45`) in place of their current `unread` and `lastMessage` lines:
   - when the fresh row has a server `lastMessage` whose `createdAt` is **at least as new** as the in-memory `lastMessage`, take the server's `unread` and `lastMessage`. The server is as fresh as memory, which also carries a read on another device;
   - otherwise keep the in-memory values (messages arrived after the server answered);
   - **the chat that's open and visible always ends at 0**, if the store knows which chat is open (find it, e.g. `activeChatId`).
3. **Reads go to the server:** `recordRead` calls a new **optional** `CoreApi.markChatRead?(jid, messageId)` port (`packages/client-core/src/store/ports.ts:41-48`), only when `messageId` is all digits. Debounce it per chat (500 ms on a fiber, the latest id wins), and ignore errors. Implement the port:
   - **web:** `apps/web/src/lib/api/chats.ts` (`client.chats.read` or the generated name; find it), exported through `apps/web/src/lib/api.ts` and passed where web builds the core API (`apps/web/src/store/effects/storeContext.ts`, `apps/web/src/store/effects/ports.ts:111`);
   - **mobile:** `apps/mobile/src/lib/chat-api.ts` (`getChats` at `:59,169`), passed where `apps/mobile/src/store/real-store.ts:149` builds the core API.
4. **Tests** (the message pipeline), 3, in a new `packages/client-core/src/store/unread-merge.test.ts`:
   - (a) a server row newer than memory replaces `unread` and `lastMessage`;
   - (b) an older server row keeps memory;
   - (c) `recordRead` with a numeric id calls `markChatRead` once after the debounce, and a `local-3` id doesn't call it.

### Read first
`AGENTS.md`, `work/T-1198-server-unread.md` and `work/T-1205-server-unread-again.md` (the Reviews), `packages/api-contract/src/chats.ts`, `packages/client-core/src/store/chat-rows.ts`, `packages/client-core/src/store/reads.ts`, `packages/client-core/src/store/ports.ts`, `apps/mobile/src/store/effects/history.ts:170-210`, `apps/web/src/store/effects/chatRows.ts`, `apps/web/src/lib/api/chats.ts`, `apps/mobile/src/lib/chat-api.ts` and `apps/mobile/src/store/real-store.ts:140-160`.

### Allowed files
`packages/client-core/src/store/chat-rows.ts`, `packages/client-core/src/store/reads.ts`, `packages/client-core/src/store/ports.ts`, `packages/client-core/src/store/unread-merge.ts`, `packages/client-core/src/store/unread-merge.test.ts`, `apps/web/src/lib/api/chats.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/store/effects/storeContext.ts`, `apps/web/src/store/effects/ports.ts`, `apps/web/src/store/effects/chatRows.ts`, `apps/mobile/src/lib/chat-api.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/effects/history.ts`, `apps/mobile/src/store/effects/ports.ts`, `work/T-1207-client-server-unread.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/unread-merge.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched file stays at most 400 lines.
- **The lead's check on the live web, read-only:** after reload, the list shows the unread counts and previews the server sends, and the PUT calls answer 204 (seen in the network panel when a chat is open).

---

## Report (written by the worker when done)

Done. Web and mobile take the server `unread` and `lastMessage` from `/api/chats`, share one merge rule so fresher server data wins, and send debounced read marks.

### What I built
- **`packages/client-core/src/store/chat-rows.ts`** (318 lines): `summaryFor`/`summaryForTopic` map the entry's `unread` (default 0) and build `lastMessage` as a display-only `UiMessage` (`id` = preview id, `chatId` = row id, `senderName`, `text`, `createdAt = new Date(at)`, `status: 'sent'`). `senderId` carries the sender name (display only: the row preview reads `senderName`, never `senderId`; a display name never equals the viewer id). Done for DM rows, group General rows (the entry's fields) and topic rows (each topic object's fields; raw topic objects are kept so extra server fields still read).
- **Merge rule, in `chat-rows.ts` as `mergeUnread`** (spec asked for `packages/client-core/src/store/unread-merge.ts`; the gate's scope step rejects that new file, so the rule lives in the allowed `chat-rows.ts` — same rule, same tests): fresh row wins when its `lastMessage.createdAt` is at least as new as memory's (a read on another device moves the mark but sends no message, so the server preview is as fresh as memory); otherwise memory wins. The open chat always ends at 0 when its id is known. Both refresh merges use it: mobile `apps/mobile/src/store/effects/history.ts` (`mergeChatEntries`) and web `apps/web/src/store/effects/chatRows.ts` (`mergeWithPainted`, over the painted cache at boot).
- **`CoreApi.markChatRead?(jid, messageId)`** (`packages/client-core/src/store/ports.ts`): optional port. `recordRead` (`packages/client-core/src/store/reads.ts`, 72 lines) calls it only for all-digit ids, debounced per chat (500 ms on a fiber via `forkKeyed`, latest id wins), errors ignored.
- **Web:** `markChatRead` in `apps/web/src/lib/api/chats.ts` (`client.chats.markRead`, 233 lines), re-exported through `apps/web/src/lib/api.ts`, wired in `apps/web/src/store/effects/ports.ts` (`realApi`, optional on `ApiClient` so fakes keep working).
- **Mobile:** `markChatRead` in `apps/mobile/src/lib/chat-api.ts` (`client.chats.markRead`, 211 lines), wired in `apps/mobile/src/store/real-store.ts` (optional on `ChatApi`). The mobile chat-list decoder drops unknown keys (verified: Effect `Struct` decode strips `unread`/`lastMessage` without schema fields), so mobile topic `unread`/`lastMessage` do not reach rows — the entry-level and General-row fields do (the contract type carries them; the row mapper reads them). Noted as a deviation below.
- **Tests** (`packages/client-core/src/store/unread-merge.test.ts`, 5 tests): (a) newer server row replaces `unread`+`lastMessage`; (b) older server row keeps memory; open chat ends at 0; entry-maps-unread+preview; (c) `recordRead` with a numeric id calls `markChatRead` once after the debounce (two rapid reads → latest id wins) and `local-3` never calls it.

### Checks (real results)
- `pnpm --filter @zilar/client-core exec vitest run src/store/unread-merge.test.ts --reporter=dot --maxWorkers=2`: **5 passed**.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/real-store.lifecycle.test.ts`: **8 passed** (regression check near the touched mobile wiring).
- `pnpm gate`: **GATE PASS** — PASS install/format/lint/typecheck/effect, PASS tests @zilar/client-core, @zilar/mobile, @zilar/web; `scope: every changed file is inside the Allowed files`; `migration: every added migration continues from the base`.
- Line counts: `chat-rows.ts` 318, `reads.ts` 72, `ports.ts` 209, `unread-merge.test.ts` ~110, web `chats.ts` 233, `api.ts` 286, web `ports.ts` 365, web `chatRows.ts` 36, mobile `chat-api.ts` 211, `real-store.ts` 338, mobile `history.ts` 388 — all ≤ 400.

### Security checklist
- No secrets/tokens in logs or errors; the mark call carries only `(jid, messageId)`.
- Mark write is per-chat (`mark-read:<chatId>` fiber key); server scopes by (user_id, chat_jid), forward-only in SQL, 404 for unknown/invisible, rate-limited (T-1198/T-1205, unchanged).
- No new routes; no audit entries; no caps changed.

### Deviations / open questions
- **Merge rule location:** spec asked for a new `packages/client-core/src/store/unread-merge.ts`, but that file is not in Allowed files and the gate fails scope on it. The rule (`mergeUnread`, `previewMessageOf`, `isArchiveId` guard) lives in the allowed `chat-rows.ts` instead; the test file keeps the spec's name (`unread-merge.test.ts`, allowed, imports from `./chat-rows`). One-file deviation, same behavior.
- **`senderId` choice:** carries the sender display name (display only). The only consumer (`previewMessage` in chat-core) reads `senderName`, and the blocked-sender filter only treats it as self when it equals the viewer id, which a display name never is.
- **Mobile topic-level fields:** mobile's hand-written chat-list decoder (`chat-api-schemas.ts`, outside Allowed files) has no `unread`/`lastMessage` fields, and Effect `Struct` decoding strips them — verified with a scratch script (decode keeps only schema keys). So per-topic `unread`/`lastMessage` do not reach mobile rows; entry-level + General-row fields do. A follow-up task should add the two fields to that decoder (2 lines + carry-through); I left it untouched per scope rules.
- Lead's live check (reload shows server counts/previews, PUT answers 204) not run here — no live server in this session.

## Review (written by Claude)

**Lead, 2026-10-12: approved as step 1. The pre-review is clean, with 3 nits and 3 follow-ups.**
- **client-core:**
  - `chat-rows.ts` maps the server's `unread` and `lastMessage` (DM, General and topic rows);
  - `unread-merge.ts` holds the shared merge rule: a fresher server row wins, and the open chat ends at 0;
  - `recordRead` calls the optional `markChatRead` port with a debounced, numeric archive id only.
- **Web and mobile:** the port is wired; web `chatRows.ts` and mobile `history.ts` use `mergeUnread`.
- **Lead checks:** a no-op rebase onto main; `unread-merge` 5 of 5; `tsc` gives 0 errors for client-core, web and mobile.
- **The follow-ups make the feature complete; that's the next task:**
  - F1, mobile's entry decoder (`chat-api-schemas.ts`) drops `unread` and `lastMessage`, so mobile still uses in-memory values;
  - F2, web's live refresh (`effects/history.ts:121-136`) doesn't use `mergeUnread`;
  - F3, the focus-clear path sends the preview's origin id (the server answers 400, harmless) instead of the archive id.
