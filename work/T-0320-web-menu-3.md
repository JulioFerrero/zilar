---
id: T-0320
title: "Web kit migration: ChatHeader and TaskStrip menus use the kit Menu (fixes Escape leaving the chat on narrow screens)"
status: merged
milestone: M5
branch: task/T-0320-web-menu-3
model: auto
effort: low
depends_on: [T-0319]
estimate: 0.3 day
---

# T-0320: kit Menu, batch 3

## Spec (written by Claude, do not edit)

### Why
This is the last four hand-rolled web menus. There is also a real bug:
- `ChatHeader.tsx` (lines 64-76) and `TaskStrip.tsx` (lines 108-122) close their menus from a `document` `keydown` listener on Escape, **without** `stopPropagation`;
- `apps/web/src/routes/ChatShell.tsx:32-40` has a `window` `keydown` listener that calls `navigate('/')` on Escape when `!isWide` and a chat is open;
- so on a narrow screen, pressing Escape in the chat header's kebab menu, or in a task strip menu, closes the menu **and leaves the chat**.

The kit `Menu` (`apps/web/src/components/ui/menu.tsx`, from T-0318, with `backdropClassName` from T-0319) stops Escape at the document. Read the T-0318 and T-0319 Reports first.

### Verified facts (do not re-derive)
- **`Menu`:**
  - props: `open`, `onClose`, `label`, `closeLabel`, `className` (merged with `cn`), `backdropClassName` and `children`;
  - its keyboard focus helper only finds `[role="menuitem"]:not([disabled])`.
- **`apps/web/src/components/ChatHeader.tsx`:**
  - lines 64-76: the Escape listener;
  - the topic menu (around lines 186-240): backdrop `aria-label="Close chat menu"`, then a `div role="menu" aria-label="Topic actions"` (`absolute top-full right-0 z-20 mt-1 min-w-[180px] rounded-xl border border-border bg-popover py-1 shadow-lg`) holding:
    - Topic info, Pinned messages and Search (`role="menuitem"` buttons);
    - `<ChatPrefMenuItems …><TopicArchiveItem …/></ChatPrefMenuItems>`.
  - The non-topic menu (around lines 241-270): the same backdrop, then `aria-label={`Actions for ${chat.title}`}` (`min-w-[196px]`), holding Pinned messages and `ChatPrefMenuItems`.
  - `menuRef` is at line 62.
- **`apps/web/src/components/TaskStrip.tsx`:**
  - lines 108-122: the Escape listener for `statusOpen`, `ownerOpen` and `linkOpen`;
  - the status menu (around lines 256-285): backdrop "Close status menu", then `role="menu" aria-label="Change status"` (`absolute top-full left-0 z-20 mt-1 min-w-[160px] …`), with `role="menuitemradio"` items;
  - the owner menu (around lines 306-360): backdrop "Close owner picker", then `aria-label="Change owner"` (`… max-h-64 … overflow-y-auto …`), with `menuitemradio` items;
  - the link form (`linkOpen`) is **not** a menu. It keeps an Escape-to-close of its own.
- **Tests:** `apps/web/src/components/TaskStrip.test.tsx`, `apps/web/src/components/ChatPrefs.test.tsx` and `apps/web/src/components/TopicsMockE2E.test.tsx`.

### What to build
1. **`Menu`:** the focus helper also includes `[role="menuitemradio"]` and `[role="menuitemcheckbox"]`, both excluding disabled ones. Add a test in `apps/web/src/components/ui/menu.test.tsx`.
2. **ChatHeader:**
   - both menus render through `<Menu open={menuOpen} onClose={() => setMenuOpen(false)} closeLabel="Close chat menu" label=… className="top-full right-0 mt-1 …">`, keeping each menu's `min-w`;
   - the items stay as they are;
   - remove the Escape listener at lines 64-76, and `menuRef` if it becomes unused.
3. **TaskStrip:**
   - the status and owner menus render through `Menu` with their labels and close labels;
   - keep their placement classes, and for the owner menu `max-h-64 overflow-y-auto`;
   - the items stay as they are;
   - the document listener now only handles the link form (`linkOpen`), and it must call `event.stopPropagation()` on Escape too.
4. **Tests:**
   - existing tests keep passing; the three listed tests may change only where the Escape or focus mechanics moved;
   - add a regression test: with a stub `window` `keydown` listener registered, Escape in the ChatHeader menu closes the menu and does not reach the window listener.
   - Put the test in a new `apps/web/src/components/ChatHeader.menu.test.tsx`, or in `ChatPrefs.test.tsx`.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/menu.tsx` and its test, `work/T-0318-web-kit-menu.md` and `work/T-0319-web-menu-2.md` (Reports), `apps/web/src/routes/ChatShell.tsx:28-40`, `apps/web/src/components/ChatHeader.tsx`, `apps/web/src/components/TaskStrip.tsx` and the three tests.

### Allowed files
`apps/web/src/components/ui/menu.tsx`, `apps/web/src/components/ui/menu.test.tsx`, `apps/web/src/components/ChatHeader.tsx`, `apps/web/src/components/ChatHeader.menu.test.tsx`, `apps/web/src/components/TaskStrip.tsx`, `apps/web/src/components/TaskStrip.test.tsx`, `apps/web/src/components/ChatPrefs.test.tsx`, `apps/web/src/components/TopicsMockE2E.test.tsx`, `work/T-0320-web-menu-3.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot menu ChatHeader TaskStrip ChatPrefs TopicsMockE2E
pnpm gate
```

### Acceptance
- No hand-rolled `role="menu"` is left in `ChatHeader.tsx` or `TaskStrip.tsx`.
- Escape in any of the four menus closes only the menu and never reaches the window, so a narrow screen stays in the chat.
- The arrow keys work, `menuitemradio` items included.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

All four hand-rolled menus now render through the kit `Menu`; Escape in any
of them closes only the menu (the kit `Menu` stops it at the document), so
a narrow screen stays in the chat.

Files changed:
- `apps/web/src/components/ui/menu.tsx`: focus helper (`enabledItems`)
  now also finds `[role="menuitemradio"]` and `[role="menuitemcheckbox"]`,
  both excluding disabled ones.
- `apps/web/src/components/ui/menu.test.tsx`: added test that focus moves
  across menuitem / menuitemradio / menuitemcheckbox with ArrowDown wrap.
- `apps/web/src/components/ChatHeader.tsx`: both menus (topic,
  `min-w-[180px]`; non-topic, `min-w-[196px]`) render through
  `<Menu open={menuOpen} onClose={...} closeLabel="Close chat menu"
  label=... className="top-full right-0 mt-1 ...">`; items unchanged;
  removed the document Escape listener and the now-unused `menuRef`
  (and the `useEffect`/`useRef` imports).
- `apps/web/src/components/TaskStrip.tsx`: status (`min-w-[160px]`) and
  owner (`max-h-64 overflow-y-auto`) menus render through `Menu` with
  their labels/close labels; items unchanged; the document listener now
  only handles the link form (`linkOpen`) and calls
  `event.stopPropagation()` on Escape.
- `apps/web/src/components/ChatHeader.menu.test.tsx` (new): regression
  test — with a stub `window` keydown listener registered, Escape in the
  ChatHeader topic menu closes the menu and does not reach the window
  listener (the stub throws if reached).
- Existing `TaskStrip.test.tsx`, `ChatPrefs.test.tsx`,
  `TopicsMockE2E.test.tsx`: unchanged, all pass.

Deviations: none. Note the container styling now comes from `Menu`
(`border-border-strong bg-surface` vs the old `border-border bg-popover`),
same shell swap as T-0318/T-0319.

Commands (real results):
- `pnpm install`: exit 0.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot
  src/components/ui/menu.test.tsx src/components/ChatHeader.menu.test.tsx
  src/components/TaskStrip.test.tsx src/components/ChatPrefs.test.tsx
  src/components/TopicsMockE2E.test.tsx`: 5 files passed, 32 tests passed.
- `pnpm gate`: GATE PASS — install PASS, format PASS, lint PASS,
  typecheck PASS, tests @zilar/web PASS, scope: every changed file is
  inside the Allowed files.

Fix round 1: `ChatHeader.menu.test.tsx` now uses a `vi.fn()` window spy
with `expect(onWindowKeyDown).not.toHaveBeenCalled()` instead of a
throwing listener, plus a control test proving the spy sees window
keydown events when no menu is open.

Security checklist: N/A — no secrets, no deletes/updates, no caps, no
permissions, no new routes, no audit entries; menus only render existing
actions.

## Review (written by Claude)

**Approved** after one lead fix round (paid Muse fallback). The first regression test threw inside a window listener; jsdom only reports such errors and does not fail the test, so the test could pass vacuously. It now uses a `vi.fn` spy that must not be called, plus a control test showing that the spy does see Escape when no menu is open.
- The ChatHeader topic and chat menus and the TaskStrip status and owner menus render through `Menu`; no hand-rolled `role="menu"` is left on web.
- `Menu` also focuses `menuitemradio` and `menuitemcheckbox` items.
- The TaskStrip link form keeps its own Escape, now with `stopPropagation`.
- **Bug fixed:** on narrow screens, Escape in these menus no longer reaches ChatShell's window handler, which used to leave the chat.
