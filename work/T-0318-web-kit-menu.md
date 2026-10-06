---
id: T-0318
title: "Web kit: Menu (dropdown with keyboard support); the main menu and the New chat menu use it"
status: todo
milestone: M5
branch: task/T-0318-web-kit-menu
model: auto
effort: low
depends_on: []
estimate: 0.4 day
---

# T-0318: web kit Menu

## Spec (written by Claude, do not edit)

### Why
Seven web components hand-roll a `role="menu"` dropdown: `ChatList`, `NewChatButton`, `MessageActionsMenu`, `ChatActionsMenu`, `ChatHeader` (two) and `TaskStrip` (two). Each has its own look and keyboard handling:
- the main menu in `ChatList` has no Escape handling at all;
- none of them moves focus with the arrow keys.

The web kit (`apps/web/src/components/ui/`) has `Dialog`, `Sheet` and `Button`, but no menu. This task adds a kit `Menu` and moves the two simplest menus onto it.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ChatList.tsx`, lines 120-260:** the main menu.
  - The trigger is `IconButton aria-label="Open menu" aria-haspopup="menu" aria-expanded={menuOpen}`, wrapped in a `div className="relative"`.
  - When open, it renders a full-screen `button` (`tabIndex={-1}`, `aria-label="Close menu"`, `fixed inset-0 z-10`) and a `div role="menu" aria-label="Main menu"` with the class `absolute top-full right-0 z-20 mt-1 min-w-[180px] rounded-xl border border-border bg-popover py-1 shadow-lg wide:left-0 wide:right-auto`.
  - Its items are `button role="menuitem"` with the class `flex w-full items-center px-3 py-2 text-left text-[15px] hover:bg-surface-raised`; each one closes the menu, then acts.
  - The Requests item shows a count badge.
  - There is no Escape handling.
- **`apps/web/src/components/NewChatButton.tsx`:**
  - the menu is at lines 148-200+: the same backdrop (`aria-label="Close new chat menu"`) and a `div role="menu" aria-label="New chat actions"` (`absolute right-0 bottom-full z-20 mb-2 …`);
  - items use `MENU_ITEM_CLASS` (line 14);
  - lines 128-140: a document `keydown` listener closes on Escape and calls `focusTrigger()` (line 41, `triggerRef`).
- **Kit conventions** (see `apps/web/src/components/ui/sheet.tsx` and `dialog.tsx`):
  - `cn` for classes;
  - a `*.fixture.tsx` per component for React Cosmos (`sheet.fixture.tsx` shows a stateful sample), which `ui/fixtures.test.tsx` renders automatically;
  - tests use `@testing-library/react`.
- **Tests:** `apps/web/src/components/ChatList.test.tsx` and `apps/web/src/components/NewChatButton.test.tsx`.

### What to build
1. **New `apps/web/src/components/ui/menu.tsx`.**
   - **`Menu`.** Props:
     - `open: boolean`;
     - `onClose: () => void`;
     - `label: string` (the menu's `aria-label`);
     - `closeLabel: string` (the backdrop button's `aria-label`);
     - `className?: string` (placement classes such as `top-full right-0 mt-1`);
     - `children`.

     When open, it renders:
     - the backdrop `button` (`type="button"`, `tabIndex={-1}`, `fixed inset-0 z-10 cursor-default`, `onClick={onClose}`);
     - the `div role="menu"` with `cn('absolute z-20 min-w-[180px] rounded-xl border border-border-strong bg-surface py-1 shadow-lg', className)`.

     Behaviour:
     - on open, it focuses the first enabled `[role="menuitem"]` (in a layout effect) and remembers the element that had focus;
     - Escape anywhere while open (a document `keydown` listener) closes the menu, calls `stopPropagation`, and returns focus to the remembered element;
     - ArrowDown and ArrowUp move focus between the enabled items, wrapping around; Home and End go to the first and last item;
     - Tab closes the menu.
   - **`MenuItem`.** Props: `onSelect`, `icon?` (a lucide component, drawn at `size-4` and `aria-hidden`), `destructive?`, `disabled?`, `children`.
     - It renders `button type="button" role="menuitem"` with `flex w-full items-center gap-2 px-3 py-2 text-left text-[15px] hover:bg-list-hover focus-visible:bg-list-hover focus-visible:outline-none disabled:opacity-50`, with `text-danger` when `destructive`.
2. **New `apps/web/src/components/ui/menu.fixture.tsx`:** a trigger button that opens a sample menu with three items, one of them destructive.
3. **Kit tests** (in `apps/web/src/components/ui/kit.test.tsx`, or a new `menu.test.tsx`):
   - open focuses the first item;
   - ArrowDown, ArrowUp, Home and End move focus as described;
   - Escape closes the menu and restores focus to the trigger;
   - a backdrop click closes it;
   - disabled items are skipped.
4. **`ChatList` main menu:**
   - use `<Menu open={menuOpen} onClose={() => setMenuOpen(false)} label="Main menu" closeLabel="Close menu" className="top-full right-0 mt-1 wide:left-0 wide:right-auto">` with a `MenuItem` per entry;
   - same order, texts and actions; the Requests badge stays as a child of its item.
5. **`NewChatButton` menu:**
   - use `<Menu … label="New chat actions" closeLabel="Close new chat menu" className="right-0 bottom-full mb-2">` with `MenuItem`s;
   - remove its own Escape listener and `MENU_ITEM_CLASS`, since `Menu` now handles Escape and focus;
   - keep `closeMenu` and `focusTrigger` wherever the dialogs still need them.
6. **Tests:** existing `ChatList` and `NewChatButton` tests keep passing. Add one `ChatList` test: Escape closes the main menu.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/sheet.tsx`, `apps/web/src/components/ui/sheet.fixture.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/ChatList.tsx`, `apps/web/src/components/NewChatButton.tsx` and their tests.

### Allowed files
`apps/web/src/components/ui/menu.tsx`, `apps/web/src/components/ui/menu.fixture.tsx`, `apps/web/src/components/ui/menu.test.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/ChatList.tsx`, `apps/web/src/components/ChatList.test.tsx`, `apps/web/src/components/NewChatButton.tsx`, `apps/web/src/components/NewChatButton.test.tsx`, `work/T-0318-web-kit-menu.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot menu kit ChatList NewChatButton
pnpm gate
```

### Acceptance
- `Menu` and `MenuItem` exist, with tests and a Cosmos fixture.
- Both menus render through them, with the same items, texts, labels and actions.
- Escape and the arrow keys work in both menus.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
`MessageActionsMenu`, `ChatActionsMenu`, the two `ChatHeader` menus and the two `TaskStrip` menus move in a later task.

---

## Report (written by the worker when done)

## Review (written by Claude)
