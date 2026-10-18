---
id: T-1980
title: "Message pipeline bug: jumping to a pinned card fails ('Message not found') although the message exists — the pin stores a 16-digit archive id that no loaded row matches; find the mismatch, fix it in client-core so web and phone both jump, with a regression test"
status: merged
milestone: M5
branch: task/T-1980-pin-jump-archive-id
model: anthropic/claude-sonnet-5
effort: high
estimate: 45 min
---

# T-1980: Pinned-message jump can't find a card

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18, live on chat.zilar.app: in his DM with Iryna, the pinned message is a **card** he sent. Clicking it on web shows "Message not found", although he believes the message still exists.

The lead read the live database (ids only). That pin's `pinned_messages.message_id` is a **16-digit number**, the shape of an XMPP archive id.

This is message-pipeline code, so a test is required (Julio's rule, 2026-10-10).

### Facts (read by the lead on 2026-10-18)
- **Pins store the client's id.** `apps/server/src/pins/service.ts:105-124` stores whatever `input.messageId` the client sent, and the pin's kind is `card`.
- **The jump.**
  - Web's `PinnedBanner` calls `openAtMessage(chatId, messageId)`, which is `packages/client-core/src/store/history.ts:259-300`.
  - Its `find()` matches `k.listFor(state, chatId)` rows with `k.sameMessage(item.id, wanted) || k.sameMessage(item.id, messageId)`.
  - It maps an archive id to the row's id only through the chat preview (`lastMessage.archiveId`; see the T-1739 comment at `:270-280`).
  - It pages back until history runs out, then fails with `message_not_found`.
- **How rows get their id.** `packages/xmpp-core/src/stanza/resolve-sender.ts:118-135` (`messageId`) uses the `<stanza-id>` whose `by` is the archive owner (the room for groupchat, `me` for 1:1). Failing that, any stanza-id; then the MAM result id (`envelope.archiveId`, `parse-context.ts:122`); then the stanza's own `id`.
- **The archive id field.** `UiMessage.archiveId` exists (`packages/chat-core/src/types.ts:103`) but is set only on chat-list previews.
- **Cards are re-keyed.** Question cards are re-keyed on the server (`rekeyQuestionMessage`, T-1739), so a card's row id may differ from the id the pin was made from.
- **Archive ids differ per user.** In a 1:1 chat, each user's archive gives the same message a different id.
- **The phone.** The phone's pinned banner (`apps/mobile/src/components/chat/pinned-banner.tsx:26`) also says "Message not found" and has no history paging.

### Steps
1. **Find the root cause.** Find why this card pin's id doesn't match the card's row after a reload.
   - Trace these paths:
     - the id the client sends when pinning (web and phone pin actions);
     - the id the card row gets when it arrives live;
     - the id it gets when it is loaded from history (MAM), including the card re-key path;
     - what `sameMessage` and the ledger aliases cover.
   - Name the exact mismatch in the Report, with `file:line`.
2. **Fix it in `packages/client-core`** (and in `xmpp-core` decode, if needed), so `openAtMessage` finds a pinned message by any id the pin may carry: origin id, this user's archive id, or the re-keyed card id.
   - A likely shape: when a row is decoded from MAM or live with a known archive id, keep that id (`UiMessage.archiveId` or a ledger alias), and let `find()` match it.
   - Choose the smallest correct fix, and explain it.
   - Don't change the server pin format; existing pins must start working.
3. **Fix the pin action too**, if it sends an id that can't be matched later, so new pins store the stable id.
4. **Add one regression test** in the nearest client-core test file. It loads a history page in which the card's row id differs from its archive id, then checks that `openAtMessage(chatId, archiveId)` resolves to that row.
5. **Keep the phone in step.** If the fix lives in client-core, the phone gets it for free. Don't add phone history paging; just say in the Report whether the phone's jump now finds loaded messages pinned by archive id.

### Allowed files
- `packages/client-core/src/store/history.ts`
- `packages/client-core/src/store/history-core.ts`
- `packages/client-core/src/store/ledger-ids.ts`
- `packages/client-core/src/store/pins.ts`
- `packages/client-core/src/store/history.test.ts`
- `packages/client-core/src/store/pins.test.ts`
- `packages/xmpp-core/src/stanza/decode.ts`
- `packages/xmpp-core/src/stanza/resolve-sender.ts`
- `packages/chat-core/src/types.ts`
- `work/T-1980-pin-jump-archive-id.md`

If the fix needs another file, stop and name it in the Report; don't edit it.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store --reporter=dot
pnpm gate
```

### Acceptance
- The Report names the root cause with `file:line`.
- The regression test fails without the fix and passes with it.
- The gate passes.
- After the push, the lead checks that Julio's live pin jumps.

---

## Report (written by the worker when done)

### What I did

Fix round 1 (pre-review must-fixes) changes the first-round text below as follows. Where they conflict, this block wins:

- **Pin action reverted.** `pins.ts` is back to `pinSnapshotFor(chatId, message)`, so new pins store the row id again, and `pins.test.ts` is deleted. Web (`apps/web/src/store/realStore.ts:106`) and phone (`apps/mobile/src/components/chat/use-chat-screen.ts:183`) compare pins to row ids with strict equality, so a pin holding the archive id would stop matching its row there. I did not open those two files myself; I rely on the pre-review for that. The "Fix" bullet for `pins.ts` and the `pins.test.ts` note below no longer apply. Step 3 of the spec ("fix the pin action too, if it sends an id that can't be matched later") is therefore not done: the row id is what web and phone compare, and the history alias keeps it resolvable.
- **Alias direction swapped.** `history.ts` `linkArchiveId` now calls `k.linkMessageIds(ui.id, message.archiveId)`. The row's existing root stays its root, so `wireTargetFor` and `correctionTargetFor` keep naming the origin id. Before, the archive id became the root, so reactions and replies to history-loaded DM messages would have named this user's own archive id, which the other person never matches. `find()` still matches by archive id because `sameMessage` compares alias roots.
- **New test** in `history.test.ts` ("keeps the origin id as the wire target after aliasing the archive id (T-1980)"): a history page loads a row with origin id `origin-7` and an archive id; `openAtMessage(ANA, archiveId)` resolves the row and `k.wireTargetFor(row.id)` is `origin-7`. With the old direction (`history.ts` reverted, test kept) it fails with `expected '1792170770205830' to be 'origin-7'`.

First-round text (root cause and the rest of the fix):

**Root cause.** `openAtMessage`'s `find()` (`packages/client-core/src/store/history.ts:278-285`,
unchanged line numbers before my edit) resolves an archive id to a row id *only* through the
chat's current preview: `const wanted = preview?.archiveId === messageId ? preview.id :
messageId;`. That only ever helps when the pinned message is the chat's single newest message
(`lastMessage`). Julio's card is not the newest message in his DM with Iryna (the conversation
kept going after it), so `preview.archiveId` never equals the pin's id, `wanted` stays the raw
16-digit archive id, and `k.sameMessage(item.id, messageId)` is checked against every loaded
row's `.id` — which is whatever `resolve-sender.ts`'s `messageId()` (`:116-132`) resolved for
that row (a `<stanza-id>` when the forwarded/archived stanza carries one, which can differ from
the MAM `<result id>` the pin was made from, per the task's "cards are re-keyed" and "archive ids
differ per user" facts). No row's `.id`, nor any ledger alias, was ever linked to the raw MAM
archive id outside the single-preview case, so the jump pages back through all of history and
fails with `message_not_found` even though the card is loaded.

**Fix (client-core + xmpp-core decode, smallest shape I found that stays inside the Allowed
files).**
- `packages/xmpp-core/src/stanza/decode.ts`: carries the MAM `<result id>` separately from the
  row's displayed `id`, as `ChatMessage.archiveId`. `types.ts` has a 400-line cap shared with
  another task (its own comment says so), so — following the exact precedent already in this
  package (`types-ack.ts`, `types-delivered.ts`, `core-effect/config.ts`) — the field joins
  `ChatMessage` through a `declare module '../types'` augmentation inside `decode.ts`, not by
  editing `types.ts` itself (which is not in this task's Allowed files; I checked the gate's
  scope sweep confirms this stays in scope). Set right after `originId` is captured.
- `packages/client-core/src/store/history.ts`: new `linkArchiveId()` helper wraps
  `k.toUiMessage(...)` and, when the raw stanza carries `archiveId`, aliases it to the row with
  the ledger's existing `k.linkMessageIds(archiveId, ui.id)` (no new ledger-ids.ts code needed —
  `linkMessageIds` was already exposed on `k`). Used in `loadOlderPage`, `openHistory` and
  `loadPreview`, the three places a raw stanza becomes a bubble. After this, `k.sameMessage`
  (hence `find()`'s existing `k.sameMessage(item.id, messageId)` check) matches a loaded row by
  this user's own archive id regardless of where in history it sits, on top of the untouched
  preview-based path (kept for the existing T-1739 "newest card" test, which still passes).
- `packages/client-core/src/store/pins.ts`: `pinMessage` now sends the archive id
  (`archiveIdOf(ctx, message)`, the existing helper from `delivered.ts`, already alias-aware via
  `wireTargetFor`) instead of the row's current displayed id, when it is already known —
  per step 3, so a pin made after the chat has loaded through MAM stores the id that survives a
  later re-key or reload, not whatever transient id the row happens to carry at pin time. Falls
  back to the row's id exactly as before when no archive id is known yet (e.g. a message pinned
  right after sending, before any MAM load) — existing pins and this fallback case are unchanged.
- No change was needed in `resolve-sender.ts`, `history-core.ts`, `ledger-ids.ts` or
  `chat-core/src/types.ts`; `k.linkMessageIds`/`k.sameMessage` already existed and did everything
  needed once the archive id was carried through.

**Phone.** The fix lives entirely in `@zilar/client-core` (`history.ts`, `pins.ts`) and
`@zilar/xmpp-core` (`decode.ts`), both shared by web and mobile; `apps/mobile/src/store/*` was
not touched. Mobile's `openAtMessage` (`apps/mobile/src/store/effects/history.ts:269`) calls the
same `history.openAtMessage` from client-core, so once a message is loaded on the phone (mobile
has no history paging, per the spec, and I did not add any), its `find()` benefits from the same
archive-id alias for a message already in the loaded list. I did not run the mobile app or a
phone smoke test; I'm reporting this from reading the code only, not from testing the phone.

### Checks run

Fix round 1 (the first-round results below are from before it):

- `pnpm --filter @zilar/client-core exec vitest run src/store --reporter=dot`: 15 test files, 189 tests passed (16 files and 191 tests before, because `pins.test.ts` is gone; `history.test.ts` has one more test).
- `pnpm gate`: `GATE PASS` (install, format, lint, typecheck, effect PASS; `tests @zilar/client-core` PASS; `tests @zilar/xmpp-core` SKIP, no nearby test files; scope, migration, images and size clean). I did not re-run the xmpp-core tests this round; `decode.ts` is unchanged since round 1.

First round:

- `pnpm --filter @zilar/client-core exec vitest run src/store --reporter=dot`: 16 test files,
  191 tests passed.
- `pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot` (not in the task's Checks
  list, run because I touched `decode.ts`): 4 test files, 150 tests passed.
- Confirmed the new regression test (`history.test.ts`, "finds a MAM-loaded card by its archive
  id, not just the chat preview (T-1980)") fails with `message_not_found` when `history.ts`,
  `pins.ts` and `decode.ts` are reverted to `main`, and passes with the fix.
- `pnpm gate`: `GATE PASS`. Summary: `install (frozen)` PASS, `format` PASS, `lint` PASS,
  `typecheck` PASS, `effect` PASS, `tests @zilar/client-core` PASS (12.6s), `tests
  @zilar/xmpp-core` SKIP ("no nearby test files" — the gate's own nearest-test heuristic doesn't
  find `stanza.test.ts` for `decode.ts`; I ran it manually above instead). Scope: every changed
  file inside the Allowed files. Size: every changed file within 400 lines. Migrations/images:
  n/a, nothing in those categories changed.

### Notes for the lead

- `packages/xmpp-core/src/types.ts` was never edited — the Allowed files list didn't include it,
  and it also carries an explicit 400-line cap for another task, so I used the module-augmentation
  pattern already established in the same package instead (see "What I did"). Flagging this in
  case you'd rather the field lived in `types.ts` directly on review.
- Added `packages/client-core/src/store/pins.test.ts` (new file, inside Allowed files) with three
  small tests for the `pins.ts` change: archive id preferred when known, row id used as a
  fallback when not, and the existing "message not found" failure unchanged. The spec only
  required the one history.ts regression test; I added these because the pin action's behavior
  changed and pins sit on the message pipeline.
- I could not fully verify the live XMPP mechanics that made Julio's specific card's `<stanza-id>`
  diverge from its own archive id (that depends on the ejabberd server's exact behavior when
  archiving the two sides of a 1:1 chat, which I don't have access to). The fix is general: it
  makes `openAtMessage` match a loaded row by this user's own MAM archive id whenever it differs
  from the row's displayed id, for any reason, old and new pins alike — not specific to one
  explanation of why they diverged.

## Review (written by Claude)

Approved after one fix round. The first pre-review caught two real regressions:
- new pins stored the archive id, which would have broken pin badges and the phone jump;
- the alias went the wrong way, which would have made reactions and replies to history-loaded DM messages name this user's own archive id.

The fix:
- **Decode:** `decode.ts` now carries the MAM archive id onto `ChatMessage.archiveId`.
- **History:** each history-loaded row links that archive id onto the row's own root (`linkMessageIds(ui.id, archiveId)`). So `openAtMessage(chat, archiveId)` resolves the row, while `wireTargetFor` still names the origin id.
- **Pins:** they keep storing row ids.

Follow-ups:
- an end-to-end test from decode to history for `archiveId`;
- pin badges could match through the ledger alias instead of strict equality.

The live check is Julio's pinned card in the DM with Iryna, after the deploy.
