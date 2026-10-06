---
id: T-0363
title: "Web kit: the message actions menu items (Reply, Edit, Copy, Delete, Pin) use MenuItem"
status: merged
milestone: M5
branch: task/T-0363-web-message-menu-items-kit
model: auto
effort: low
depends_on: [T-0359]
estimate: 0.2 day
---

# T-0363: message actions menu on MenuItem

## Spec (written by Claude, do not edit)

### Why
T-0359 moved the chat menus onto the kit `MenuItem`. The message actions menu is the last menu with hand-rolled items.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/menu.tsx`:** `MenuItem({ onSelect, icon?, destructive?, disabled?, ariaLabel?, children })` renders `<button role="menuitem">`, with the `hover:bg-list-hover` look and `text-danger` when `destructive`.
- **`apps/web/src/components/MessageActionsMenu.tsx`:**
  - line 27: `const ITEM_CLASS = 'flex w-full items-center px-3 py-2 text-left text-[15px]'`;
  - six hand-rolled `role="menuitem"` buttons (lines 72-145):
    1. Reply (`onReply`);
    2. Edit (`onEdit`, only when `canEdit`);
    3. Copy text (`disabled={!canCopy}`, `onCopy`);
    4. Delete for everyone (`disabled={!canDelete}`, `onDelete`, `text-danger`);
    5. Unpin (`onUnpin`);
    6. Pin (`onPin`). Unpin and Pin show only when `canPin`, chosen by `isPinned`.
  - The quick-reaction buttons (lines 60-70, `key-icon` round emoji keys with `aria-label` `React with ${emoji}`) are not text items. Leave them.
- **Tests that query these items by role and name:** `apps/web/src/components/MessageActions.test.tsx` and `apps/web/src/components/StickerPanel.test.tsx`. Keep every visible name, so no test should change.

### What to build
1. Replace the six buttons with `<MenuItem onSelect=…>`. Keep:
   - the same text and conditions;
   - `disabled` where set;
   - `destructive` on "Delete for everyone".
2. Remove `ITEM_CLASS`, and remove the `cn` import if they become unused.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/menu.tsx`, `work/T-0359-web-chat-menu-items-kit.md` (Report) and `apps/web/src/components/MessageActionsMenu.tsx`.

### Allowed files
`apps/web/src/components/MessageActionsMenu.tsx`, `apps/web/src/components/MessageActions.test.tsx`, `apps/web/src/components/StickerPanel.test.tsx`, `work/T-0363-web-message-menu-items-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot MessageActions StickerPanel
pnpm gate
```

### Acceptance
- No hand-rolled `role="menuitem"` text button remains in `MessageActionsMenu.tsx`; the quick reactions stay.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)
- Replaced the six hand-rolled text `role="menuitem"` buttons in `MessageActionsMenu.tsx` (Reply, Edit, Copy text, Delete for everyone, Unpin/Pin) with kit `MenuItem`, keeping the same text, conditions (`canEdit`, `canPin`/`isPinned`), `disabled` on Copy/Delete, and `destructive` on Delete. Quick-reaction buttons left untouched.
- Removed `ITEM_CLASS`; kept the `cn` import (still used for the `Menu` placement classes).
- No test changes needed; visible names unchanged.
- Files changed: `apps/web/src/components/MessageActionsMenu.tsx`, `work/T-0363-web-message-menu-items-kit.md`.
- Commands:
  - `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot MessageActions StickerPanel`: 2 files, 35 tests passed.
  - `pnpm gate`: PASS install, PASS format, PASS lint, PASS typecheck, PASS tests @zilar/web; scope: every changed file inside Allowed files; GATE PASS.
- Security checklist: no secrets/tokens, deletes/updates, permissions, caps, routes, or audit entries involved — N/A.

## Review (written by Claude)

Approved (lead, 2026-10-06). The six message menu items are `MenuItem` with the same texts, conditions and `disabled`; Delete is `destructive`; `ITEM_CLASS` is gone. Pre-review clean (0 findings). The quick-reaction row stays as specified.
