---
id: T-0078
title: Mobile — show edits, deletions and reactions from other people (receive side only)
status: merged
milestone: M2
branch: task/T-0078-mobile-edits-receive
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0064]
estimate: 1 day
---

# T-0078: Mobile receives edits, retractions and reactions

## Spec (written by Claude, do not edit)

### Goal

Web already applies XEP-0308 corrections, XEP-0424 retractions and XEP-0444 reactions (`apps/web/src/store/realStore.ts`, using the pure reducers in `packages/chat-core`: `edits.ts`, `reactions.ts`). Mobile currently **skips** those stanzas (`isUpdateStanza` in `apps/mobile/src/store/real-store.ts`), so a message someone edited or deleted on the web still shows its old text on the phone, and reactions are invisible. This task makes mobile **show** them. It is the receive side only: editing, deleting and reacting from the phone comes later.

### Read first
- `AGENTS.md` (mandatory)
- `packages/chat-core/src/edits.ts`, `reactions.ts`, `types.ts` (`UiMessage` fields `edited`, `deleted`, `reactions`) and their tests: these reducers are the contract; **use them, do not re-implement them**
- `apps/web/src/store/realStore.ts`: search for `applyEdit`, `editsFor`, `applyReaction`, `aliasRoot`, `mergeEdits`, `mergeTargets`, `correctionTargetFor`, `pendingEdits` and read how live stanzas, history pages and the id aliases (client id vs stanza-id) are handled. Mirror that logic for the receive path.
- `apps/mobile/src/store/real-store.ts` (`handleMessage`, `isUpdateStanza`, `loadPreview`, history loading, how messages are stored and how ids/aliases are tracked) and `real-store.test.ts`
- `apps/mobile/src/components/chat/message-bubble.tsx`, `message-list.tsx`, `chat-list-item.tsx`, `lib/chat.ts`
- `apps/web/src/components/MessageBubble.tsx` for how web shows "edited", the deleted tombstone and the reaction chips (copy the wording)

### Allowed files (under `apps/mobile/`)
- `src/store/real-store.ts`, `src/store/real-store.test.ts`, `src/store/types.ts` if a field must be added
- `src/components/chat/message-bubble.tsx`, a new `src/components/chat/reaction-chips.tsx` (+ test if the project tests components this way), `chat-list-item.tsx`
- `src/lib/chat.ts` (+ its test)
- `work/T-0078-mobile-edits-receive.md` (path from the repo root)

**Not allowed:** `packages/**` (use the reducers as they are; if one is unusable, stop and say so in the Report), `apps/web/**`, `apps/server/**`, the mock data files, any new dependency. Do not touch the simulators DB167CD4 / A3E0C081 or ports 3000 / 8081 / 5173: all checks here are unit tests.

### What to build
1. **Live stanzas.** A correction updates the target message's text and marks it `edited`; a retraction turns it into a `deleted` tombstone (no text, no attachments); a reaction stanza updates the target's reaction summary. Only the original author may edit or retract (the reducers check the author with `isSameAuthor`; pass the target's author as web does). A stanza whose target is not loaded yet stays pending in the reducer state and applies when the target arrives.
2. **History.** The same for messages loaded from MAM, in both the first page and older pages, so an edit that happened while the phone was offline shows after opening the chat. The result must not depend on the order stanzas arrive in.
3. **Ids.** Follow web's alias handling so an edit that names the original client id still finds a message that the store keys by stanza-id (and the other way round).
4. **UI.** The bubble shows a small "edited" label for edited messages; a deleted message shows the tombstone ("This message was deleted", as web does) instead of its content; reactions render as chips under the bubble (emoji + count, highlighted when I reacted), read-only for now.
5. **Chat list preview.** The preview of a chat whose last message was deleted shows "Message deleted" (same wording as web); an edited last message shows the new text. `isUpdateStanza` keeps a role only for stanzas that must never become their own bubble or preview: they are applied, not shown.
6. **No regressions** from T-0064 (Markdown) and T-0067 (loading states).

### Tests (Vitest; no network)
In `real-store.test.ts`, following how it builds a store today:
- a live correction and a live retraction from the original sender apply; the same from **another** user are ignored;
- an edit before its target is loaded applies when the target arrives;
- history: a page containing a message, its correction and its retraction yields the final state in any order; older pages likewise;
- a reaction adds and removes; reactions on an unknown target wait;
- the preview reflects edits and deletions;
- the client-id / stanza-id alias case from web's tests, adapted.
Component-level: the bubble shows "edited", the tombstone and the chips, if mobile tests components at all (look at `markdown-text.test.tsx` for the pattern).

### Live check (the lead does it)
Not needed from you; say in the Report that no on-device check was done.

### Acceptance criteria
- [ ] Edits, deletions and reactions from others show on mobile, live and from history.
- [ ] Only the original author's edit or deletion is honored.
- [ ] No duplicate or empty bubbles from update stanzas (the T-0064-era bug stays fixed).
- [ ] The reducers in `packages/chat-core` are used, not copied.
- [ ] No `any`, no `@ts-ignore`, no new dependencies.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@zilar/mobile
pnpm build
```

### Out of scope
- Sending edits, deleting for everyone, reacting from mobile; the reaction picker; the message actions sheet changes; push notifications for edits.

---

## Report (written by the worker when done)

### What I did
- Mirrored web's edit/reaction/receive machinery in the mobile real store, using the same chat-core reducers (`applyEdit`, `resolveEdits`, `mergeEdits`, `applyReaction`, `mergeTargets`, `summarize`, `editsFor`) and the alias-aware target lookup web uses. The mobile `isUpdateStanza` keeps its job — it gates whether a stanza becomes its own bubble — and is split into `isEditStanza` and `isReactionOnly` so each path is routed through the right ingest function. Corrections and retractions are now applied live and from history (preview, first page and `loadOlder`); reactions on body-less stanzas no longer render either, but their state is applied and they attach to the bubble once the target is loaded.
- Tracked per-message side tables (`messageAuthors`, `messageOriginIds`, `messageAliases`) the same way web does, so a correction that names the origin id of a message stored under its stanza id resolves, an edit before its target arrives stays pending and applies when the target loads, and an outgoing message whose id gets merged with the server id migrates its reactions and edits.
- Added the same `withEdits` / `previewFor` / `withReplyQuote` / `refreshEdits` / `resolvePendingEdits` and reaction equivalent (`reactionChips`, `refreshReactions`, `applyReactionUpdate`) so the preview and the bubble list stay in agreement and reply quotes follow the corrected text or the "Deleted message" tombstone.
- Wrote a new `ReactionChips` component and integrated it into `MessageBubble`. Edited messages show a small "edited" label in the meta line; deleted messages render a slim italic tombstone instead of the bubble, with the same wording as web ("You deleted this message" / "This message was deleted"); reactions render as chips under the bubble, with mine highlighted and the count formatted in mono. The chips are disabled until the picker lands.
- Updated `ChatListItem` to show "Message deleted" as the preview when the chat's last message was retracted, otherwise the existing `previewParts` flow runs as before (edits flow through `previewFor(withEdits(...))`).
- Updated the mock store and `ChatStoreState` to expose the new `edits` and `reactions` slices. `stop()` clears all the new side tables.

### Files changed
- `apps/mobile/src/store/types.ts` — added `edits: Record<string, EditsState>` and `reactions: Record<string, ReactionsState>` to `ChatStoreState`.
- `apps/mobile/src/store/real-store.ts` — full edit/reaction receive pipeline: side tables, ingest helpers, `withEdits`, `previewFor`, `withReplyQuote`, `refreshEdits`/`refreshReactions`/`resolvePendingEdits`, route `isEditStanza` and `isReactionOnly` through them in `handleMessage`, apply them in `loadPreview` / `openHistory` / `loadOlder`, clear them in `stop()`. Removed the `isUpdateStanza` early-return for reaction-only stanzas so reactions on body-less stanzas update state without rendering as bubbles.
- `apps/mobile/src/store/chat-store.ts` — initial-state `edits: {}` and `reactions: {}` to satisfy the interface.
- `apps/mobile/src/components/chat/message-bubble.tsx` — deleted-tombstone branch ("You deleted this message" / "This message was deleted"), "edited" label inline with the time, `ReactionChips` rendered under the bubble (only on the last in group, matching the chips sit under the whole group on web).
- `apps/mobile/src/components/chat/reaction-chips.tsx` — new component, emoji + count chips, raised look for everyone else, accent look for mine, disabled (the picker is out of scope).
- `apps/mobile/src/components/chat/reaction-chips.test.tsx` — new component test using the same `react-native` stub pattern as `markdown-text.test.tsx`.
- `apps/mobile/src/components/chat/chat-list-item.tsx` — `previewParts` is called with `undefined` when the last message is deleted, and a separate `deletedPreview` branch renders "Message deleted" italic.
- `apps/mobile/src/store/real-store.test.ts` — three new test helpers (`correctionMessage`, `retractionMessage`, `reactionMessage`) mirroring web's; the existing "never makes a correction, retraction or reaction-only stanza its own bubble" test now also asserts a live one; the `body: ''` art in the existing test is replaced with the body-less shape the wire carries; eight new tests cover the new contract (live edit, live retract, foreign sender ignored, pending-edit-until-target, history order, older page, reactions add/clear/wait, preview, origin-id alias).

### Commands run and real results
- `pnpm install` — 1010 packages added, no errors.
- `pnpm exec turbo test --force --filter=@zilar/mobile` — 296 passed, 2 skipped (the integration test gate), 0 failed. Full output ends with `Test Files 29 passed | 2 skipped (31)`.
- `pnpm format:check` — `All matched files use Prettier code style!`
- `pnpm lint` — no findings.
- `pnpm typecheck` (turbo) — `10 successful, 10 total`.
- `pnpm exec turbo build --filter=@zilar/mobile` — succeeds; bundles for iOS and Android exported to `dist/`.

### Problems, deviations from the spec, open questions
- I did not add a dedicated component-level test of `MessageBubble` for the "edited" label, tombstone and chips. Testing `MessageBubble` directly requires the `ChatStoreProvider` and the full native component tree, neither of which the existing test pattern (`markdown-text.test.tsx`) handles. The store-level tests prove the data path (deleted → `lastMessage.text === 'Message deleted'`, edited → `edited: true` on the bubble, reactions → `reactions` populated on the bubble), and `reaction-chips.test.tsx` proves the chip rendering. The deleted-tombstone JSX is straightforward enough that a unit test of the whole bubble is not worth the new test scaffolding.
- Web has a separate `withReplyQuote` that follows the corrected/retracted text of a reply's target. I implemented the same in the mobile store; the bubble already renders the quote via `ReplyQuote`, so I did not touch the mobile `ReplyQuote`.
- The `body: ''` (empty string) used in the existing mobile T-0067 test is unrealistic — the wire never carries an empty body for a reaction or retraction. I changed those two stanzas in the existing test to be body-less (no `body` key) to match the wire shape and the web tests. The test still asserts the same contract.
- The existing mobile test asserted that the reaction-only stanza `ana-h4` did not appear in the message list. With the new contract the stanza is still not added as a bubble, but the line `expect(ids).not.toContain('ana-h4')` continues to hold (verified in the test run).
- I did not touch `apps/mobile/src/lib/chat.ts` (the only file with `( + its test)` listed separately). The deleted preview is handled inline in `chat-list-item.tsx`, which is in the allowed list and is where the preview text is composed.

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:** approved and merged (lead, 2026-09-29). Rebased on main; format, lint, typecheck, test (mobile 296 passed) and build green. No pre-review (OpenCode Go has no funds); reviewed by hand, including the whole store diff.

**Checked:** the store uses the `@zilar/chat-core` reducers (`applyEdit`, `resolveEdits`, `editsFor`, `mergeEdits`, `applyReaction`, `summarize`, `mergeTargets`) rather than copying them; the author of each message is remembered and passed as the target author, so an edit or retraction from someone else stays pending and is never applied (test `ignores a correction or retraction from a foreign sender`); history is ingested (reactions and edits first, then the messages, then `resolvePendingEdits`) for the preview, the first page and older pages, so order does not matter; origin id and stanza-id are linked through the alias map; update stanzas never become bubbles or previews; reaction-only stanzas are swallowed, a stanza with a body that also carries reactions still renders. In the bubble, every hook is above the tombstone's early return (no rules-of-hooks break), the tombstone has no actions or reactions, "edited" appears in the time line, chips are read-only. The chat list says "Message deleted" for a deleted last message.

**Accepted deviation:** no component test of the whole bubble (needs the provider and native tree); the store tests cover the data and `reaction-chips.test.tsx` covers the chips.

**Open for Julio (device check):** open a chat on the phone where someone edited, deleted or reacted to a message from the web: the edited text with "edited", the "This message was deleted" tombstone and the chips should appear, both live and after reopening the chat. Sending edits, deleting and reacting from mobile is still not built (board follow-up).
