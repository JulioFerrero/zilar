---
id: T-0085
title: Mobile — react, delete for everyone and edit your own messages (send side)
status: in-progress
milestone: M2
branch: task/T-0085-mobile-edits-send
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0078]
estimate: 1.5 days
---

# T-0085: Mobile sends reactions, deletions and edits

## Spec (written by Claude, do not edit)

### Goal

T-0078 made the phone **show** edits, deletions and reactions. This task lets the person **do** them from the phone, the way the web app already does (`apps/web/src/store/realStore.ts`: `react`, `startEdit`, `cancelEdit`, `editMessage`, `deleteForEveryone`; UI in `MessageBubble.tsx`, `MessageActionsMenu.tsx`, `ReactionChips.tsx`, `EditBar.tsx`). The reducers are shared (`@galena/chat-core`) and `@galena/xmpp-core` already has `sendReactions`, `sendCorrection` and `sendRetraction`. Work in three steps **in this order** and commit after each so partial progress is safe: (1) reactions, (2) delete for everyone, (3) edit.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0078-mobile-edits-receive.md` (spec, report and review: the store pieces it added and what it deliberately left out)
- `apps/web/src/store/realStore.ts`: `react`, `wireTargetFor`, `correctionTargetFor`, `retractionTargetFor`, `editMessage`, `deleteForEveryone`, `restoreMessage`, `restoreEdits`, `editTarget`/`actionError` state, `rebaseMentions`, `mentionsForTrimmedText`; and how web's tests cover them (`realStore.test.tsx`)
- `packages/chat-core/src/edits.ts` (`canEditMessage`, `canDeleteMessage`, `EDIT_WINDOW_MS`), `reactions.ts` (`QUICK_REACTIONS`, `MAX_REACTIONS_PER_MESSAGE`), `types.ts`; `packages/xmpp-core/src/types.ts` (`sendReactions`, `sendCorrection`, `sendRetraction` signatures and docs) — do not edit `packages/**`
- `apps/mobile/src/store/real-store.ts`, `chat-store.ts`, `types.ts` (state shape, how `core` and `myJid()` are reached, the id maps that T-0078 added: aliases, `messageOriginIds`, and whatever tracks server ids) and `real-store.test.ts`
- `apps/mobile/src/components/chat/message-actions-sheet.tsx` (Reply / Copy / a disabled Delete today), `message-bubble.tsx`, `reaction-chips.tsx` (read-only today), `composer.tsx`, `message-list.tsx`
- `apps/web/src/components/EditBar.tsx` and the web composer's edit mode for the wording and the flow

### Allowed files (under `apps/mobile/`)
- `src/store/real-store.ts`, `real-store.test.ts`, `chat-store.ts`, `types.ts`
- `src/components/chat/message-actions-sheet.tsx`, `message-bubble.tsx`, `reaction-chips.tsx`, `reaction-chips.test.tsx`, `composer.tsx`, `message-list.tsx`, and a new `edit-bar.tsx` (+ tests where the project's pattern allows)
- `src/lib/chat.ts` and its test if a pure helper is needed
- `work/T-0085-mobile-edits-send.md` (path from the repo root)

**Not allowed:** `packages/**`, `apps/web/**`, `apps/server/**`, the mock data files (if mock mode needs a fake send path, keep it inside the store's existing mock branch and say so), new dependencies. Do not touch the simulators DB167CD4 / A3E0C081 or ports 3000 / 8081 / 5173: every check is a unit test.

### What to build
**Step 1: reactions.**
- Store action `react(chatId, messageId, emoji)` mirroring web: alias-resolved local key, wire target = the server id (a still-unacked `local-` message cannot be reacted to: do nothing), toggle the emoji in my current set, optimistic apply through the existing `applyReactionUpdate`, send with `core.sendReactions`, undo on failure. Respect `MAX_REACTIONS_PER_MESSAGE`.
- UI: the long-press sheet shows a row of the `QUICK_REACTIONS`; tapping one reacts and closes the sheet; tapping a chip under a bubble toggles **my** reaction of that emoji. Chips highlight when mine (already do). Accessibility labels on every control.

**Step 2: delete for everyone.**
- `deleteForEveryone(chatId, messageId)` mirroring web (only my own messages, `canDeleteMessage`; wire target from the retraction rule: origin id in a DM, stanza-id in a group; optimistic tombstone through the edits reducer; on failure restore the message and set `actionError`).
- UI: the sheet's disabled Delete becomes real for my messages, with a confirm step ("Delete for everyone?" / Cancel / Delete), hidden for other people's messages. An `actionError` for the chat shows as a small inline notice above the composer with a dismiss action.

**Step 3: edit.**
- `startEdit`, `cancelEdit`, `editMessage` mirroring web (`canEditMessage`: my own text messages within 48 h, no voice/image/card; no-op edits blocked; correction target = the sender-generated origin id; mentions rebased; optimistic apply; restore on failure).
- UI: "Edit" in the sheet for editable messages; the composer enters an edit mode with a bar showing the original text and a cancel button, the input prefilled; send saves the edit instead of sending a new message; leaving edit mode restores the previous draft; the edited bubble shows the "edited" label (already there).

### Tests (Vitest; no network, no device)
In `real-store.test.ts`, following how it builds a store with a fake core:
- react: adds, removes (toggle), respects the cap, does nothing for a `local-` message, undoes on `sendReactions` failure, sends the right target id in a DM and in a group;
- delete: only own messages, right wire target in DM vs group, optimistic tombstone, restore + `actionError` on failure;
- edit: only own text within the window, no-op blocked, right target (origin id), optimistic text + `edited`, restore on failure, `cancelEdit` clears the target;
- an edit or delete of a message that has not been acked yet does nothing (no stanza).
Component/pure-helper tests where the project's pattern allows (`reaction-chips.test.tsx` renders as a plain function call; test any new pure logic in a plain module rather than through hooks, as T-0082 did with `approval-state.ts`).

### Live check (the lead does it)
Not needed from you; say in the Report that no on-device check was done and which steps are complete.

### Acceptance criteria
- [ ] Reacting, deleting for everyone and editing work from the phone and show on the web (protocol-correct targets in DMs and groups).
- [ ] Optimistic UI with a real rollback on failure; nothing is sent for a message without a server id.
- [ ] Only the sender can edit or delete; time window enforced.
- [ ] Imports use the `@/` alias like the surrounding code; no `console.log`, `any` or `@ts-ignore`; no new dependency.
- [ ] Lint, format, typecheck, tests and build all pass **after your last edit** (re-run them; do not rely on an earlier run).

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
- An emoji picker beyond the quick reactions, who-reacted lists, push notifications, forwarding, multi-select, any web or server change.

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
