---
id: T-0078
title: Mobile — show edits, deletions and reactions from other people (receive side only)
status: todo
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
pnpm exec turbo test --force --filter=@galena/mobile
pnpm build
```

### Out of scope
- Sending edits, deleting for everyone, reacting from mobile; the reaction picker; the message actions sheet changes; push notifications for edits.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:**
