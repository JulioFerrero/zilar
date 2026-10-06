---
id: T-0359
title: "Web kit: MenuItem takes an aria-label; the chat row, header and topic menus use MenuItem"
status: merged
milestone: M5
branch: task/T-0359-web-chat-menu-items-kit
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0359: chat menu items on the kit MenuItem

## Spec (written by Claude, do not edit)

### Why
T-0318 to T-0320 moved the menus onto the kit `Menu`, but the items inside them are still hand-rolled `<button role="menuitem">`s with a copied class. The kit `MenuItem` cannot carry an `aria-label`, and these items need one.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/menu.tsx:157-180`:**
  - `MenuItem({ onSelect, icon, destructive, disabled, children })` renders `<button type="button" role="menuitem">` with `flex w-full items-center gap-2 px-3 py-2 text-left text-[15px] hover:bg-list-hover focus-visible:bg-list-hover … disabled:opacity-50`;
  - it renders the icon at `size-4`, and turns red when `destructive`;
  - it has no `aria-label`.
- **`apps/web/src/components/ChatActionsMenu.tsx`:**
  - line 9 exports `CHAT_MENU_ITEM_CLASS` (the same look as `MenuItem`, with `hover:bg-surface-raised`);
  - `ChatPrefMenuItems` has five `role="menuitem"` buttons (lines 48-110):
    1. Pin or Unpin, with `aria-label` `Pin ${chat.title}` or `Unpin ${chat.title}` and a `Pin`/`PinOff` icon;
    2. each mute duration;
    3. Unmute;
    4. Mute or Mute…, with `aria-label` `Mute ${chat.title}` or `Change mute for ${chat.title}` and a `BellOff`/`Bell` icon;
    5. Archive or Unarchive chat, with `aria-label` `Archive chat ${chat.title}` or `Unarchive chat ${chat.title}` and an `Archive` icon.
- **`apps/web/src/components/ChatHeader.tsx`:**
  - imports `CHAT_MENU_ITEM_CLASS` (line 7);
  - has hand-rolled items at lines 180 ("Topic info"), 191 ("Pinned messages"), 202 ("Search") and 237 ("Pinned messages");
  - `TopicArchiveItem` at line 282 has `disabled={archiving}`, `aria-label={`Archive topic ${chat.title} for everyone`}` and the text "Archiving…" or "Archive topic for everyone".
- **Tests:** they find these items by role `menuitem` and accessible name. For example, `apps/web/src/components/ChatHeader.menu.test.tsx` and `apps/web/src/components/ChatList.test.tsx`. Keep every accessible name, and no test should need a change.
- **Out of scope:** `apps/web/src/components/MessageActionsMenu.tsx`, which is a later task.

### What to build
1. Add an optional `ariaLabel?: string` to `MenuItemProps` and pass it as `aria-label`. Add a `apps/web/src/components/ui/menu.test.tsx` case: a `MenuItem` with `ariaLabel` is found by that name.
2. Replace the five `ChatPrefMenuItems` buttons and the five ChatHeader buttons (the four items plus `TopicArchiveItem`) with `MenuItem`. Keep:
   - every `aria-label` (as `ariaLabel`), `disabled`, handler, visible text and icon (pass the lucide icon component as `icon`);
   - the `Pin`/`PinOff` and `Bell`/`BellOff` choices. Pick the component in a variable, then pass it.
3. Remove `CHAT_MENU_ITEM_CLASS` and its import if nothing uses it any more. Check with grep.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/menu.tsx`, `apps/web/src/components/ui/menu.test.tsx`, `apps/web/src/components/ChatActionsMenu.tsx` and `apps/web/src/components/ChatHeader.tsx:150-300`.

### Allowed files
`apps/web/src/components/ui/menu.tsx`, `apps/web/src/components/ui/menu.test.tsx`, `apps/web/src/components/ChatActionsMenu.tsx`, `apps/web/src/components/ChatHeader.tsx`, `apps/web/src/components/ChatHeader.menu.test.tsx`, `apps/web/src/components/ChatList.test.tsx`, `work/T-0359-web-chat-menu-items-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot menu ChatHeader ChatList
pnpm gate
```

### Acceptance
- No `role="menuitem"` `<button>` remains in `ChatActionsMenu.tsx` or `ChatHeader.tsx`.
- `MenuItem` supports `ariaLabel`.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)
- Added optional `ariaLabel?: string` to `MenuItemProps` in `ui/menu.tsx`, passed as `aria-label` on the button.
- Replaced the 5 hand-rolled `role="menuitem"` buttons in `ChatPrefMenuItems` (Pin/Unpin, mute durations, Unmute, Mute/Mute…, Archive/Unarchive) with `MenuItem`, keeping every `aria-label` (as `ariaLabel`), handler, text, and icon; `Pin`/`PinOff` and `Bell`/`BellOff` chosen via `PinIcon`/`BellIcon` variables passed as `icon`.
- Replaced the 4 hand-rolled items in `ChatHeader.tsx` (Topic info, Pinned messages x2, Search) plus `TopicArchiveItem` with `MenuItem`, keeping `disabled`, `ariaLabel`, handlers, and text.
- Removed `CHAT_MENU_ITEM_CLASS` export and its import (grep confirms no remaining users outside `MessageActionsMenu.tsx`, which is out of scope).
- Added `menu.test.tsx` case: a `MenuItem` with `ariaLabel="Pin General"` is found by that name.
- Files changed: `apps/web/src/components/ui/menu.tsx`, `apps/web/src/components/ui/menu.test.tsx`, `apps/web/src/components/ChatActionsMenu.tsx`, `apps/web/src/components/ChatHeader.tsx`.
- Commands:
  - `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot menu ChatHeader ChatList`: 6 files, 60 tests passed.
  - `pnpm gate`: PASS install, PASS format (after prettier --write on the 2 touched files), PASS lint, PASS typecheck, PASS tests @zilar/web; scope: every changed file inside Allowed files; GATE PASS.
- Security checklist: no secrets/tokens touched; no deletes/updates, permissions, caps, routes, or audit entries involved — N/A.

## Review (written by Claude)

**Approved** (pre-review clean, 0 nits). `MenuItem` takes `ariaLabel`, and a new test covers it. The lead grep found no hand-rolled `role="menuitem"` button left in `ChatActionsMenu.tsx` or `ChatHeader.tsx`, and `CHAT_MENU_ITEM_CLASS` is gone. The existing menu tests pass unchanged, so the accessible names are kept.
