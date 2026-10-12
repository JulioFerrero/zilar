---
id: T-1288
title: "Mobile batch 1: Message on a contact's profile opens the DM instead of 'Pull to refresh' (MUX-16); touch targets reach 44 dp (MUX-17); pull-to-refresh on the topics list (MUX-28); a check icon on the send key while editing (MUX-30); haptics on chat-row long-press (MUX-22)"
status: todo
milestone: M5
branch: task/T-1288-mobile-touch-fixes
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1288: Mobile batch 1

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mobile-ux-audit.md`:
- **MUX-16** (P2, `:77`): on a contact's profile, "Message" can fail with "No chat with them yet. Pull to refresh the chats list." (`apps/mobile/src/app/u/[handle].tsx`).
- **MUX-17** (P2, `:105`): touch targets under 44 dp: the send key, quick reactions and others listed there.
- **MUX-28** (P3, `:93`): no `refreshControl` on the topics list (`apps/mobile/src/components/chat/group-topic-list.tsx`).
- **MUX-30** (P3, `:51`): edit mode keeps the `ArrowUp` icon on the send key (`apps/mobile/src/components/chat/composer-input-row.tsx`).
- **MUX-22** (P3, `:63`): no haptic on chat-row long-press.

**First recheck each finding on main.** For any already fixed, say so with `file:line` and skip it.

### What to build
1. **MUX-16:** Message opens the DM directly. If the chat row isn't known yet, create or open it the way the web New message flow does (cite the shared or web helper), and never ask the user to refresh.
2. **MUX-17:** add `hitSlop` (or padding) so each target the audit lists reaches 44 dp, with no visual change.
3. **MUX-28:** a `RefreshControl` on the topics list wired to the group refresh (cite it), the same pattern as the chat list's.
4. **MUX-30:** a `Check` icon on the send key while editing.
5. **MUX-22:** a Light impact on chat-row long-press, the same helper the bubbles use (cite it).
6. **No tests** (UI). Keep every file at most 400 lines.

### Read first
`AGENTS.md`, `docs/audit/mobile-ux-audit.md` (`:51`, `:63`, `:77`, `:93`, `:105`), and the files above.

### Allowed files
`apps/mobile/src/app/u/[handle].tsx`, `apps/mobile/src/components/chat/*.tsx`, `apps/mobile/src/components/chat/*.ts`, `apps/mobile/src/store/**/*.ts`, `work/T-1288-mobile-touch-fixes.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the emulator mock:**
  - Message from a contact's profile opens the DM;
  - the topics list refreshes on pull;
  - edit mode shows a check on the send key.

---

## Report (written by the worker when done)

## Review (written by Claude)
