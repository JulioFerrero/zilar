---
id: T-1287
title: "Shared client fixes: React/Edit/Delete are disabled until a message has a wire id (UI-7); a failed sticker gets status 'failed' like attachments (UI-14); a chat discovered by a refresh is placed by recency with its preview (UI-12); web sign-out calls ledger.reset() (UI-13); tested"
status: todo
milestone: M5
branch: task/T-1287-client-ui-fixes
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1287: Shared client fixes from the features audit

## Spec (written by Claude, do not edit)

### Why
`docs/audit/features-ui-audit.md`:
- **UI-7** (P2, `:148`, suspected): react, edit and delete return silently when the bubble has no wire id yet (`packages/client-core/src/store/actions.ts`), so a tap on a still-sending message does nothing.
- **UI-14** (P2, `:155`): a failed sticker is flagged `failed: true` but keeps `status: 'sending'` (`ledger-mutators.ts`), unlike attachments and voice, so the ticks keep the clock.
- **UI-12** (P2, `:178`): a chat that first appears in a refresh goes to the top without a preview, and on the next tick `sortByRecency` sinks it to the bottom.
- **UI-13** (P2, `:195`): web `resetUserState` (`apps/web/src/store/effects/lifecycle.ts`) clears three ledger maps by hand and never calls `ledger.reset()`, which mobile does.
- **UI-8** (`:163`, typed text lost when switching chats) may already be fixed. Check it and report only.

**First recheck each finding on main.** For any already fixed, say so with `file:line` and skip it.

### What to build
1. **UI-7:**
   - add a `canAct(message)` (or `canReact`) selector in chat-core, beside `canEditMessage`, that is false while the wire target is unknown;
   - use it to disable or hide React, Edit and Delete in the web menu (`apps/web/src/components/MessageActionsMenu.tsx`) and the mobile sheet (`apps/mobile/src/components/chat/message-actions-sheet.tsx`).
2. **UI-14:** a failed sticker goes through the same `markSendFailed` path (reason `network`), and its retry through `markSendRetrying`.
3. **UI-12:** insert a newly discovered chat by recency (or load its preview first) so it doesn't jump; fix it in the shared code if both apps share it, otherwise in both apps.
4. **UI-13:** web `resetUserState` calls the ledger's `reset()` and drops the manual clears.
5. **Tests** (the message pipeline), up to 3, in the nearest client-core tests:
   - the UI-14 status;
   - the UI-12 placement;
   - `canAct` false for a message without a wire id.

### Read first
`AGENTS.md`, `docs/audit/features-ui-audit.md` (`:148-200`), `packages/client-core/src/store/actions.ts`, `packages/client-core/src/store/ledger-mutators.ts`, `packages/client-core/src/store/rows.ts` and `apps/web/src/store/effects/lifecycle.ts`.

### Allowed files
`packages/chat-core/src/**/*.ts`, `packages/client-core/src/**/*.ts`, `apps/web/src/store/**/*.ts`, `apps/web/src/components/MessageActionsMenu.tsx`, `apps/web/src/components/message/MessageMenu.tsx`, `apps/mobile/src/store/**/*.ts`, `apps/mobile/src/components/chat/message-actions-sheet.tsx`, `apps/mobile/src/components/chat/message-bubble-actions.tsx`, `work/T-1287-client-ui-fixes.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass. Every file stays at most 400 lines.

---

## Report (written by the worker when done)

## Review (written by Claude)
