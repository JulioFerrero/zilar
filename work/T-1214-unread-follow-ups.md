---
id: T-1214
title: "MP-F3 finish (T-1207 follow-ups): the server preview also carries its archive id and the client uses it as the preview message id (so read marks from a preview are valid), mobile's /api/chats decoder keeps unread and lastMessage (rows and topics), and web's live refresh applies mergeUnread"
status: merged
milestone: M5
branch: task/T-1214-unread-follow-ups
model: auto
effort: default
depends_on: [T-1207]
estimate: 0.3 day
---

# T-1214: Finish server unread on both apps

## Spec (written by Claude, do not edit)

### Why
T-1207 (merged) taught the apps to read `unread` and `lastMessage` from `/api/chats` and to send read marks. Its pre-review found three gaps:
- **F1, mobile drops the fields.** Mobile's `/api/chats` decoder doesn't keep them: `apps/mobile/src/lib/chat-api-schemas.ts` (252 lines). The entry schema keeps `topics` as raw objects validated by `parseTopic` (`:70-73,164-175`), but has no `unread` or `lastMessage`. So mobile still shows only in-memory unread.
- **F2, web's live refresh uses the old merge.** `apps/web/src/store/effects/history.ts:115-140` (218 lines) still copies the in-memory `unread` and `lastMessage` over the server's, instead of using `mergeUnread` (`packages/client-core/src/store/chat-rows.ts:87`, as `apps/web/src/store/effects/chatRows.ts` now does).
- **F3, a preview's id isn't a read mark.** The focus-clear path `clearActiveChatRead` (`packages/client-core/src/store/polling.ts:62-80`) sends `chat.lastMessage.id`. When that preview came from the server, its id is the **origin id** (the server's `lastMessage.id`, `apps/server/src/chats/unread.ts`), and `PUT /api/chats/:jid/read` answers 400 for a non-numeric id. Live messages carry the archive id.

### What to build
1. **Server** (`apps/server/src/chats/unread.ts` and `packages/api-contract/src/chats.ts`): `lastMessage` gains `archiveId: string`, the row's `timestamp` as a decimal string. Bind and read it as a string; no `BigInt` reaches postgres.js (the T-1198 incident, `work/T-1205-server-unread-again.md`). It's an optional field, so old clients ignore it. Extend `apps/server/src/chats/reads.test.ts` so one existing preview assertion also checks `archiveId`.
2. **client-core** (`chat-rows.ts`, `previewMessageOf` at `:49`): use `archiveId` as the preview `UiMessage.id` when present, and the origin id otherwise. Then `clearActiveChatRead` and `recordRead` send a valid mark without other changes; confirm it in the Report. Keep `chat-rows.ts` at most 400 lines.
3. **Mobile decoder** (`chat-api-schemas.ts`): keep `unread` (number) and `lastMessage` (the contract shape) on the entry, and pass them through to what `summariesFor` reads. For topics, keep the two fields on each raw topic object, or carry them alongside it; find what `chatEntryTopics` (`chat-rows.ts:125`) expects, and cite it.
4. **Web live refresh** (`apps/web/src/store/effects/history.ts:115-140`): replace the `unread` and `lastMessage` carry-over with `mergeUnread`, the same call `chatRows.ts` makes, with the active chat id.
5. **Tests** (the message pipeline), in `packages/client-core/src/store/unread-merge.test.ts` (the file T-1207 added), plus 1: a server preview with `archiveId` becomes a `UiMessage` with that id, and `recordRead` with it calls `markChatRead`.

### Read first
`AGENTS.md`, `work/T-1207-client-server-unread.md` (the Report and the Review), `work/T-1205-server-unread-again.md`, `packages/client-core/src/store/chat-rows.ts`, `packages/client-core/src/store/polling.ts:55-85`, `apps/mobile/src/lib/chat-api-schemas.ts`, `apps/web/src/store/effects/history.ts:100-145`, `apps/web/src/store/effects/chatRows.ts`, `apps/server/src/chats/unread.ts` and `packages/api-contract/src/chats.ts`.

### Allowed files
`apps/server/src/chats/unread.ts`, `apps/server/src/chats/reads.test.ts`, `packages/api-contract/src/chats.ts`, `packages/client-core/src/store/chat-rows.ts`, `packages/client-core/src/store/unread-merge.test.ts`, `apps/mobile/src/lib/chat-api-schemas.ts`, `apps/web/src/store/effects/history.ts`, `packages/client-core/src/store/polling.ts`, `packages/chat-core/src/types.ts` (both added by the lead for fix round 1), `work/T-1214-unread-follow-ups.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/unread-merge.test.ts --reporter=dot
pnpm --filter @zilar/server exec vitest run src/chats/reads.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched file stays at most 400 lines.
- **The lead's check after deploy:** `/api/chats` answers 200, and a DM's `lastMessage` carries a numeric `archiveId`.

---

## Report (written by the worker when done)

Done. All five spec items are built: the server preview carries its archive id, the client uses it as the preview message id, mobile's decoder keeps `unread`/`lastMessage`, and web's live refresh applies `mergeUnread`.

### What I built
- **Server** (`apps/server/src/chats/unread.ts`, 344 lines): `ChatUnread.lastMessage` gains `archiveId: string`. Both construction sites (the page loop and the newest-row loop) set it via a new `archiveIdOf(row.timestamp)` helper that only stringifies — it never constructs a `BigInt`, so no `BigInt` reaches postgres.js (the T-1198/T-1205 incident). The timestamp column was already selected by both queries, so no SQL changed. `ChatUnreadFields` in `chats/api.ts` picks it up automatically (it references `ChatUnread['lastMessage']`); no change needed there.
- **Contract** (`packages/api-contract/src/chats.ts`, 120 lines): `ChatLastMessage` gains optional `archiveId: Schema.String`, so old clients ignore it.
- **client-core** (`packages/client-core/src/store/chat-rows.ts`, 329 lines): `previewParts` uses `archiveId` as the preview `UiMessage.id` when present (non-empty string), the origin id otherwise. Confirmed: `clearActiveChatRead` (`polling.ts:62-80`) sends `chat.lastMessage.id` with no other change — for a server preview that id is now the numeric archive id, so `recordRead`'s `isArchiveId` guard passes and `markChatRead` fires; for a live message the archive id is the MAM id as before. Covered by the new test below.
- **Mobile decoder** (`apps/mobile/src/lib/chat-api-schemas.ts`, 271 lines): `DmEntrySchema` and the group raw schema keep optional `unread` (number) and `lastMessage` (the contract shape, now with `archiveId`); both ride the parsed entry through to `summariesFor`. Topics: each raw topic object is still validated with `parseTopic` (malformed rows dropped), but the **raw** object is kept instead of the decoded `Topic`, so per-topic `unread`/`lastMessage` survive. That is what `chatEntryTopics` (`chat-rows.ts:125`) expects: it decodes each raw object with `Topic` for shape, while `summariesFor` (`:294-304`) reads the two fields off the same raw objects via `topicsByJid`. Verified no other mobile consumer reads entry topics as decoded `Topic` (store goes through core `summariesFor`; `rememberGroupIds` reads only `chatJid`/`groupId`; `group-list-item.tsx` reads `GroupRow.topics: ChatSummary[]`, unrelated).
- **Web live refresh** (`apps/web/src/store/effects/history.ts`, 221 lines): the kept-row branch now calls `mergeUnread(row, existing, activeChatId)` — the same call `chatRows.ts` makes — instead of copying in-memory `unread`/`lastMessage` over the server's. The `online`/`lastSeenAt`/`onlineCount` carry-overs are unchanged.
- **Tests**: `unread-merge.test.ts` (160 lines) gains the spec's test — a server preview with `archiveId` becomes a `UiMessage` with that id, and `recordRead` with it calls `markChatRead` once with `(chatId, archiveId)` after the debounce. `reads.test.ts` (363 lines): the existing 'counts only incoming rows after the mark, with a preview' assertion now also checks `archiveId` equals the row's timestamp decimal string.

### Checks (real results)
- `pnpm install`: done first, 14.1s, clean.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/unread-merge.test.ts`: **6 passed** (5 existing + 1 new).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chats/reads.test.ts`: **7 passed**.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/real-store.history.test.ts`: **7 passed** (regression: raw topic rows still map after the decoder change).
- Throwaway decoder check (created, ran, deleted): `parseChatsList` keeps entry-level and per-topic `unread`/`lastMessage`/`archiveId` and drops a malformed topic — **1 passed**.
- `pnpm gate`: **GATE PASS** — PASS install/format/lint/typecheck/effect, PASS tests @zilar/client-core, @zilar/mobile, @zilar/server, @zilar/web, SKIP tests @zilar/api-contract (no nearby test files); `scope: every changed file is inside the Allowed files`; `migration: every added migration continues from the base`. (First gate run failed on prettier formatting of `chat-rows.ts`; fixed with `prettier --write` on that one file, second run passed.)
- Line counts: unread.ts 344, reads.test.ts 363, contract chats.ts 120, chat-rows.ts 329, unread-merge.test.ts 160, chat-api-schemas.ts 271, web history.ts 221 — all ≤ 400.

### Security checklist
- No secrets/tokens in logs or errors; `archiveId` is a timestamp, and the T-1205 warning log is unchanged (error class + message only).
- No changes to the mark write path: forward-only SQL, per-(user, chat) scoping, shared 404, and the existing rate limit are untouched; no new routes, so the 401 sweep is unaffected; no audit entries added.
- The contract addition is optional, so older payloads still parse on both sides.

### Deviations / open questions
- None from the spec. Lead's live check (`/api/chats` answers 200 with a numeric `archiveId` on a DM's `lastMessage`) not run here — no live server in this session; `reads.test.ts` asserts exactly that shape (200 + `archiveId` equal to the row timestamp).

### Fix round 1 (lead pre-review finding 1: preview id regression)
The round-1 preview used `archiveId` as `UiMessage.id`, which would have broken displayed markers, quote jumps and dedupe that key on the origin id. Now the two ids travel separately.
- **Item 1** (`packages/chat-core/src/types.ts`, 212 lines; `packages/client-core/src/store/chat-rows.ts`, 333 lines): `UiMessage` gains optional `archiveId?: string` with a one-line comment; `previewMessageOf` sets it from `lastMessage.archiveId`. The `id = archiveId ?? id` choice is reverted — the preview `id` is the origin id again, exactly as before this task.
- **Item 2** (`packages/client-core/src/store/polling.ts`, 233 lines): `clearActiveChatRead` calls `recordRead(ctx, chatId, chat.lastMessage?.archiveId ?? chat.lastMessage?.id)` and `markDisplayed(chatId, coreKind(chat), chat.lastMessage.id)` — archive id to the server, origin id to the display, unchanged from before this task for the marker.
- **Item 3** (`unread-merge.test.ts`, 167 lines): the round-1 preview-id test is replaced with a `clearActiveChatRead` test — a DM row built by `summariesFor` from a server preview with both ids (`id: 'o-9'`, `archiveId: '1759322400000000'`), made the active chat with `unread: 2`. Asserts `markChatRead` gets `(chatId, '1759322400000000')` after the 500 ms debounce and `core.markDisplayed` gets `(chatId, 'chat', 'o-9')` synchronously.
- **Item 4**: stale citation in `chat-api-schemas.ts:179` fixed (`chat-rows.ts:125` → `:138`, the real line of `chatEntryTopics`).
- Commits: one per item (`db62f879b`, `42b279588`, `5d6a322e8`, `f0014683f`), plus `b4c20f60c`, a prettier-only reflow in `chat-rows.ts` required by the gate's format step (3 lines, no behavior change).

### Fix round 1 checks (real results)
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/unread-merge.test.ts`: **6 passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chats/reads.test.ts`: **7 passed**.
- `pnpm gate`: **GATE PASS** — PASS install/format/lint/typecheck/effect, PASS tests @zilar/chat-core, @zilar/client-core, @zilar/mobile, @zilar/server, @zilar/web, SKIP tests @zilar/api-contract (no nearby test files); `scope: every changed file is inside the Allowed files`; `migration: every added migration continues from the base`. (First gate run of the round failed on prettier formatting of `chat-rows.ts` again — the long `previewParts` return type; fixed with `prettier --write` on that one file, committed as the fixup above, second run passed.)
- Line counts: types.ts 212, chat-rows.ts 333, polling.ts 233, unread-merge.test.ts 167, chat-api-schemas.ts 271 — all ≤ 400.

## Review (written by Claude)

**Lead, 2026-10-12: approved after fix round 1. The pre-review is clean, with 1 nit.**
- **Server:** `lastMessage.archiveId` (the row timestamp as a decimal string, no `BigInt`), and the contract field is optional.
- **Clients:**
  - a preview keeps the origin id as `UiMessage.id` and carries `archiveId` beside it (`chat-core` `UiMessage.archiveId?`);
  - `clearActiveChatRead` sends the archive id to `recordRead` and the origin id to `markDisplayed`. Round 1 fixed the regression where the peer's seen ticks wouldn't update;
  - mobile's decoder keeps `unread` and `lastMessage` (rows and topics);
  - web's live refresh uses `mergeUnread`.
- **Lead checks after the rebase onto main:**
  - `unread-merge` 6 of 6, server `reads` 7 of 7;
  - `tsc` gives 0 errors for chat-core, client-core, web, mobile and server.
- **Still to do after deploy:** `/api/chats` answers 200, and a DM `lastMessage` carries a numeric `archiveId`.
