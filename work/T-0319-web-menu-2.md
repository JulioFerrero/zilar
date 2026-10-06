---
id: T-0319
title: "Web kit migration: the message actions and chat actions menus use the kit Menu shell"
status: merged
milestone: M5
branch: task/T-0319-web-menu-2
model: auto
effort: low
depends_on: [T-0318]
estimate: 0.3 day
---

# T-0319: kit Menu, batch 2

## Spec (written by Claude, do not edit)

### Why
T-0318 added the kit `Menu` (`apps/web/src/components/ui/menu.tsx`). It handles:
- focusing the first item on open;
- the arrow keys, Home and End;
- Escape, through a document listener, with `stopPropagation` and focus back to the opener;
- Tab, which closes it.

Read its Report in `work/T-0318-web-kit-menu.md` first.

Two floating menus still hand-roll their own shell, and their Escape works only while focus is inside the menu. This task swaps their **shell** for `Menu`. The items keep their own markup: they are already `button role="menuitem"`, which `Menu`'s keyboard handling finds.

### Verified facts (do not re-derive)
- **`Menu`:**
  - props: `open`, `onClose`, `label`, `closeLabel`, `className` (merged with `cn`, so the caller's classes win) and `children`;
  - the backdrop button is `fixed inset-0 z-10 cursor-default`;
  - the menu is `absolute z-20 min-w-[180px] rounded-xl border border-border-strong bg-surface py-1 shadow-lg`;
  - it has **no** prop for the backdrop's classes.
- **`apps/web/src/components/MessageActionsMenu.tsx`:**
  - lines 47-50: a `firstItemRef` plus an effect that focuses the first reaction button;
  - the backdrop `button` has `aria-label="Close message menu"` and `fixed inset-0 z-20`;
  - the menu is a `div role="menu" aria-label="Message actions"` (around line 61), with an `onKeyDown` Escape handler and the class `absolute top-6 z-30 min-w-[196px] rounded-[12px] border border-border-strong bg-surface py-1 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.9)]`, plus `right-0` or `left-0` from `align`;
  - the items are the `QUICK_REACTIONS` row of `role="menuitem"` buttons, then Reply, Edit, Copy text, Delete for everyone and Pin/Unpin.
  - It is mounted only while open: `MessageBubble.tsx:387` and `:696`.
- **`apps/web/src/components/ChatActionsMenu.tsx`:**
  - lines 120-155: `ChatActionsMenu`, with the same shell (backdrop `aria-label="Close chat menu"` `z-20`; menu `aria-label={`Actions for ${chat.title}`}` with the same classes and `align`);
  - it wraps `<ChatPrefMenuItems chat={chat} onDone={() => onClose()} />`;
  - `ChatPrefMenuItems` and `CHAT_MENU_ITEM_CLASS` are also used by `ChatHeader.tsx`, so leave both unchanged;
  - it is mounted only while open: `ChatListItem.tsx:170` and `TopicRow.tsx:164`.
- **Tests that reach these menus:** `apps/web/src/components/MessageActions.test.tsx`, `apps/web/src/components/ReactionChips.test.tsx`, `apps/web/src/components/StickerPanel.test.tsx` and `apps/web/src/components/ChatListItem.test.tsx`.

### What to build
1. **`Menu`:** add an optional `backdropClassName?: string`, merged with `cn` into the backdrop's classes. Add one test in `apps/web/src/components/ui/menu.test.tsx` for it.
2. **`MessageActionsMenu`:**
   - render `<Menu open onClose={onClose} label="Message actions" closeLabel="Close message menu" backdropClassName="z-20" className={cn('top-6 z-30 min-w-[196px] rounded-[12px] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.9)]', align === 'right' ? 'right-0' : 'left-0')}>` around the existing reaction row and items;
   - remove its own backdrop, `div`, Escape handler, `firstItemRef` and focus effect, since `Menu` focuses the first reaction;
   - all item markup and texts stay the same.
3. **`ChatActionsMenu`:** the same, with `label={`Actions for ${chat.title}`}` and `closeLabel="Close chat menu"`. `ChatPrefMenuItems` stays as it is.
4. **Tests:** existing tests keep passing. In `MessageActions.test.tsx`, add one test: Escape pressed while focus is **outside** the menu (e.g. on `document.body`) closes it. The listed tests may only be adjusted where the focus or Escape mechanics moved, and every assertion keeps checking the same behaviour.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/menu.tsx`, `apps/web/src/components/ui/menu.test.tsx`, `work/T-0318-web-kit-menu.md` (Report), the two menus and the four tests.

### Allowed files
`apps/web/src/components/ui/menu.tsx`, `apps/web/src/components/ui/menu.test.tsx`, `apps/web/src/components/MessageActionsMenu.tsx`, `apps/web/src/components/ChatActionsMenu.tsx`, `apps/web/src/components/MessageActions.test.tsx`, `apps/web/src/components/ReactionChips.test.tsx`, `apps/web/src/components/StickerPanel.test.tsx`, `apps/web/src/components/ChatListItem.test.tsx`, `work/T-0319-web-menu-2.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot menu MessageActions ReactionChips StickerPanel ChatListItem
pnpm gate
```

### Acceptance
- Both menus render through `Menu`, with the same look (`z-30` menu, `z-20` backdrop, the `rounded-[12px]` card), items and labels.
- Escape closes them from anywhere, and the arrow keys move between items, reactions included.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
The two `ChatHeader` menus and the two `TaskStrip` menus.

---

## Report (written by the worker when done)

Both floating menus now render through the kit `Menu` shell; item markup and texts are unchanged.

Files changed:
- `apps/web/src/components/ui/menu.tsx`: added optional `backdropClassName?: string`, merged with `cn` into the backdrop button classes.
- `apps/web/src/components/ui/menu.test.tsx`: added test that a custom backdrop class merges with the defaults.
- `apps/web/src/components/MessageActionsMenu.tsx`: renders `<Menu open onClose label="Message actions" closeLabel="Close message menu" backdropClassName="z-20" className={…top-6 z-30 min-w-[196px] rounded-[12px] shadow-… + align}>` around the existing reaction row and items; removed own backdrop, div, Escape handler, `firstItemRef` and focus effect.
- `apps/web/src/components/ChatActionsMenu.tsx`: same shell with `label={`Actions for ${chat.title}`}` and `closeLabel="Close chat menu"`; `ChatPrefMenuItems` and `CHAT_MENU_ITEM_CLASS` unchanged.
- `apps/web/src/components/MessageActions.test.tsx`: added test that Escape pressed while focus is outside the menu (on `document.body`, dispatched on document) closes it.

Deviations: none. The old menus had `fixed inset-0 z-20` backdrops with no `cursor-default`; the spec pins `backdropClassName="z-20"`, so the new backdrop is `fixed inset-0 z-20 cursor-default` (extra cursor class from `Menu`). Container classes keep `border-border-strong bg-surface py-1` from `Menu` merged with the caller's placement/rounding/shadow overrides, matching the old look.

Commands (real results):
- `pnpm install`: exit 0.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot menu MessageActions ReactionChips StickerPanel ChatListItem`: 6 files passed, 68 tests passed.
- `pnpm gate`: GATE PASS — install PASS, format PASS, lint PASS, typecheck PASS, tests @zilar/web PASS, scope: every changed file is inside the Allowed files.

Security checklist: N/A — no secrets, no deletes/updates, no caps, no permissions, no new routes, no audit entries; menus only render existing actions.

## Review (written by Claude)

**Approved.** Clean pre-review (1 nit), no fix rounds (the paid Muse fallback did the work and the pre-review).
- `MessageActionsMenu` and `ChatActionsMenu` render through `Menu`, keeping the `z-30` card and the `z-20` backdrop (new `backdropClassName`).
- The items are unchanged.
- The new test shows that Escape from outside the menu now closes it.

**Nit, accepted:** the backdrop test could also assert that `z-10` is gone. The implementation uses `cn` (tailwind-merge), so it is correct.
