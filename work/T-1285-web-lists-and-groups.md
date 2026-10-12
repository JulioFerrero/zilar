---
id: T-1285
title: "Web: contact requests show as a row at the top of the chat list (WUX-19); New group gets member search and allows zero members (WUX-20); message search results highlight the selected row (WUX-23); Esc in a wide layout closes the open chat (WUX-33)"
status: todo
milestone: M5
branch: task/T-1285-web-lists-and-groups
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1285: Requests row, New group search, search selection, Esc (web)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/web-ux-audit.md`:
- **WUX-19** (P2, `:47`): incoming contact requests are only a badge inside the hamburger menu (`apps/web/src/components/chatList/ChatListMenu.tsx`), polled, and easy to miss.
- **WUX-20** (P3, `:51`): `apps/web/src/components/NewGroupDialog.tsx` has no member search and demands at least one member.
- **WUX-23** (P3, `:65`): message search rows always pass `selected={false}` (`apps/web/src/components/MessageSearchResults.tsx`), and Enter opens only the top hit.
- **WUX-33** (P3, `:105`): Esc in a wide layout with a chat open does nothing (`apps/web/src/routes/ChatShell.tsx`).

**First recheck each finding on main.** For any already fixed, say so with `file:line` and skip it.

### What to build
1. **WUX-19:** when there are pending incoming requests, show a row at the top of the chat list ("Contact requests" with the count) that opens the existing requests page (cite it). Use the existing polled count.
2. **WUX-20:**
   - a search box filtering the contact list in the member step;
   - "Create" works with zero members. Check that the server accepts an empty member list: cite the route. If it doesn't, keep the minimum and say so.
3. **WUX-23:** ↑ and ↓ move a highlighted row in the message search results, Enter opens the highlighted hit, and the highlighted row passes `selected`.
4. **WUX-33:** in the wide layout, Esc with a chat open (and no dialog, menu or search open) closes the chat back to the empty state.
5. **No tests** (UI). Keep every file at most 400 lines.

### Read first
`AGENTS.md`, `docs/audit/web-ux-audit.md` (`:47-53`, `:65`, `:105`), and the files above.

### Allowed files
`apps/web/src/components/chatList/*.tsx`, `apps/web/src/components/NewGroupDialog.tsx`, `apps/web/src/components/NewGroupMembers.tsx`, `apps/web/src/components/MessageSearchResults.tsx`, `apps/web/src/components/MessageSearchResult.tsx`, `apps/web/src/routes/ChatShell.tsx`, `apps/web/src/lib/*.ts`, `work/T-1285-web-lists-and-groups.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the web mock:** the requests row shows (if the mock seeds a request); New group filters contacts; the search rows highlight with the arrows; Esc closes the chat.

---

## Report (written by the worker when done)

## Review (written by Claude)
