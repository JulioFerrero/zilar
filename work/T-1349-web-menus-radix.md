---
id: T-1349
title: "Web dropdown menus on Base UI Menu (Julio 10-14: Base UI, not Radix): rebuild ui/menu.tsx (Menu, MenuItem, MenuRadioItem) on @base-ui/react so menus are portalled, collision-aware and keyboard-complete; move the 9 call sites from placement classes to a trigger or a point anchor"
status: merged
milestone: M5
branch: task/T-1349-web-menus-radix
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1349: Web menus on Radix

## Spec (written by Claude, do not edit)

### Why
The library audit (`docs/audit/library-plan.md`, row 3). T-1344 moved Dialog and Sheet to Radix but left the menus, because they have no trigger element.
- **Hand-rolled today:** `apps/web/src/components/ui/menu.tsx` (230 lines) hand-rolls roving focus, Home/End and wrap (`:88-130`), a full-screen backdrop button (`:133-140`), and an `absolute` panel placed by call-site classes like `top-full right-0 mt-1` (`:141-150`, prop `className` `:18-19`). Menus can overflow the viewport and get clipped by `overflow` parents.
- **Earlier fix rounds:** T-0318, T-0319, T-0320 and T-0401.
- **Radix:** the `radix-ui` umbrella is already a dependency (`apps/web/package.json:30`), and T-1344 already uses its Dialog.

**Call sites** (each renders `<Menu open onClose label closeLabel className>` next to its opener):
- `apps/web/src/components/MessageActionsMenu.tsx:111`: also opens at a right-click `point` (`:45-48`), with its own viewport clamping (`:82-103`);
- `apps/web/src/components/NewChatButton.tsx:163`
- `apps/web/src/components/ChatHeader.tsx:186`, `:254`
- `apps/web/src/components/ChatActionsMenu.tsx:210`
- `apps/web/src/components/chatList/ChatListMenu.tsx:158`
- `apps/web/src/components/topic/OwnerMenu.tsx:52`
- `apps/web/src/components/attach/AttachMenu.tsx:67`: the `IconButton` opener is at `:59-66`;
- `apps/web/src/components/topic/StatusMenu.tsx:40`
- `apps/web/src/routes/ContactsPage.tsx:173`

### Library rule (Julio, 2026-10-13)
Use Radix's `DropdownMenu` from the installed `radix-ui` umbrella; don't hand-roll focus, positioning or keyboard. If the umbrella's version lacks something you need, say so, and bump it to an exact version at least two weeks old (`npm view radix-ui time --json`). **No tests** (UI). Every file stays at most 400 lines.

### What to build
1. **New `Menu` API** in `apps/web/src/components/ui/menu.tsx`, on `DropdownMenu.Root` (controlled `open` / `onOpenChange`), `Portal`, `Content` (`side`/`align`/`sideOffset`, `collisionPadding={8}`) and `Item`/`RadioItem`.
   - **Anchor:** either the opener element (wrap it with `DropdownMenu.Trigger asChild`, or export a `MenuTrigger`) or a viewport **point** for right-click. For the point, use an invisible fixed-position trigger or anchor at the point, or Radix `ContextMenu` for the right-click case; say which.
   - Keep `label` (as `aria-label`), `MenuItem` (icon, destructive and disabled as today) and `MenuRadioItem`.
   - Drop the `closeLabel` backdrop button and the placement `className`.
   - Keep the look: `rounded-xl border border-border-strong bg-surface py-1 shadow-lg`, `min-w-[180px]`, with item styles unchanged.
2. **Move all 9 call sites** to the new API. Delete `MessageActionsMenu`'s own clamping (`:82-103`), since Radix handles collisions. Keep each menu's items and behaviour.
3. **Delete** `apps/web/src/components/ui/use-modal.ts` if nothing imports it any more (T-1343 removed the `MediaViewer` import; check).
4. Update `apps/web/src/components/ui/menu.fixture.tsx` to the new API.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/menu.tsx`, `apps/web/src/components/ui/dialog.tsx` (T-1344's Radix usage), `apps/web/src/components/MessageActionsMenu.tsx`, `apps/web/src/components/attach/AttachMenu.tsx`.

### Allowed files
`apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/src/components/ui/menu.tsx`, `apps/web/src/components/ui/menu.fixture.tsx`, `apps/web/src/components/ui/use-modal.ts`, `apps/web/src/components/MessageActionsMenu.tsx`, `apps/web/src/components/NewChatButton.tsx`, `apps/web/src/components/ChatHeader.tsx`, `apps/web/src/components/ChatActionsMenu.tsx`, `apps/web/src/components/chatList/ChatListMenu.tsx`, `apps/web/src/components/topic/OwnerMenu.tsx`, `apps/web/src/components/attach/AttachMenu.tsx`, `apps/web/src/components/topic/StatusMenu.tsx`, `apps/web/src/routes/ContactsPage.tsx`, `work/T-1349-web-menus-radix.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's headless web mock check:**
  - the attach menu opens above the composer, Escape closes it, and focus returns to the opener;
  - the chat header ⋯ menu opens with ArrowDown moving between items;
  - a right-click on a message opens the message menu at the cursor, inside the viewport near the right edge.

---

## Report (written by the worker when done)

### What I did

Rebuilt `apps/web/src/components/ui/menu.tsx` on the `radix-ui` `DropdownMenu`
primitive and moved all 9 call sites to the new API.

**New API** (`ui/menu.tsx`):
- `Menu` = `DropdownMenu.Root` (controlled `open` / `onOpenChange`) + `Trigger
  asChild` + `Portal` + `Content` (`side`, `align`, `sideOffset`,
  `collisionPadding={8}`). The opener element is passed as the `trigger` prop and
  Radix wires it as the trigger; a menu with no visible opener passes an
  invisible anchor element instead. `label` goes on the content as
  `aria-label`. `onEscapeKeyDown` calls `stopPropagation()` so Escape never
  reaches ChatShell's window listener (same trick as `ui/dialog.tsx`).
- Panel look: `rounded-xl border border-border-strong bg-surface py-1 shadow-lg
  min-w-[180px]`, plus Radix's own `max-h-[var(--radix-dropdown-menu-content-available-height)]
  overflow-y-auto`. Item styles keep the old values (`px-3 py-2 text-[15px]`,
  `data-[highlighted]:bg-list-hover`, destructive red, disabled 50%).
- Dropped `closeLabel`, `backdropClassName` and the placement `className`; the
  backdrop button is gone (Radix's dismissable layer replaces it).
- Kept `MenuItem` (icon/destructive/disabled/ariaLabel) and `MenuRadioItem`.

**Anchors** (the spec asked me to say which):
- Menus with an opener element pass it as `trigger` (wrapped by
  `DropdownMenu.Trigger asChild`): AttachMenu, NewChatButton (wide + narrow
  button), ChatHeader, ChatListMenu, OwnerMenu, StatusMenu, ContactsPage,
  + both fixture menus.
- The right-click point in `MessageActionsMenu` uses an invisible
  **fixed-position anchor** at `{left: x, top: y}` inside a normal
  `DropdownMenu` (`side="bottom"`, `align="start"`, `sideOffset={0}`);
  Radix's `collisionPadding={8}` + `avoidCollisions` keep it inside the viewport
  near an edge. Its own `useLayoutEffect`/`wrapRef`/`VIEWPORT_MARGIN`/`MENU_WIDTH`
  clamping is deleted.
- `MessageActionsMenu` (no point) and `ChatActionsMenu` have no opener of their
  own — the opener button lives in `ChatListItem.tsx` / `TopicRow.tsx` /
  `MessageMenu.tsx`, which are not in the Allowed files — so they pass an
  invisible `absolute top-6 right-0`/`left-0` anchor (same spot the old panel was
  placed at) and `align`/`sideOffset={0}`.

### Deviations from the spec (called out on purpose)

- `MenuRadioItem` now takes `value: string` and lives under a new exported
  `MenuRadioGroup` (`value` + `onValueChange`), instead of the old `checked`
  prop. Radix's `RadioItem` reads its checked state from the group context and
  reports selection through `onValueChange`, so this is how the primitive is
  meant to be used; OwnerMenu and StatusMenu (both Allowed) were updated. The
  visible look is unchanged (no check indicator was drawn before either).
- Added a small exported `MenuEntry` (a thin `DropdownMenu.Item` wrapper with no
  built-in layout). `MessageActionsMenu`'s quick-reaction emoji keys use it so
  they stay real Radix items and remain reachable with the arrow keys (a plain
  `<button role="menuitem">` is not in Radix's roving-focus collection).
- Per-menu `min-w-[196px]` / `rounded-[12px]` / custom shadow overrides
  (MessageActionsMenu, ChatActionsMenu) are dropped in favour of the single
  `min-w-[180px]` panel the spec asks to keep.
- `Menu` keeps no `className` prop at all; the width/scroll belong to the shared
  panel, which is why OwnerMenu no longer passes `max-h-64 overflow-y-auto`.

### Files changed

`apps/web/src/components/ui/menu.tsx` (rewritten), `ui/menu.fixture.tsx`,
`components/MessageActionsMenu.tsx`, `components/NewChatButton.tsx`,
`components/ChatHeader.tsx`, `components/ChatActionsMenu.tsx`,
`components/chatList/ChatListMenu.tsx`, `components/topic/OwnerMenu.tsx`,
`components/topic/StatusMenu.tsx`, `components/attach/AttachMenu.tsx`,
`routes/ContactsPage.tsx`; deleted `apps/web/src/components/ui/use-modal.ts`
(nothing imported it — repo-wide grep for `use-modal`/`useModal` found only the
file itself). `apps/web/package.json` / `pnpm-lock.yaml` untouched: the installed
`radix-ui` 1.6.7 already ships `DropdownMenu` (`@radix-ui/react-dropdown-menu`
2.1.24, well over two weeks old), so no bump was needed.

### Commands run (real results)

- `pnpm install` — done, 16 workspace projects.
- `pnpm gate` — first run failed `format` on `menu.tsx` (long signature line),
  fixed with `pnpm exec prettier --write apps/web/src/components/ui/menu.tsx`;
  second run failed `typecheck` with `exactOptionalPropertyTypes` on
  `disabled={disabled}` (Radix's prop is exactly `boolean`), fixed with
  `disabled={disabled ?? false}`. Final run:

  ```
  gate: 13 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.0s)
  PASS  lint  (0.6s)
  PASS  typecheck  (2.3s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

- No single test file was run: the gate reports `no nearby test files` for
  `@zilar/web` and the spec says "No tests (UI)".

### Not verified by me

The browser behaviours in Acceptance (attach opens above the composer + Escape +
focus returns; header ⋯ ArrowDown; right-click at the cursor near the right
edge) are the lead's headless check; I reasoned them through from the Radix API
but did not run a browser. The gate's typecheck/lint/format all pass and every
changed file is inside the Allowed files.

### Blocked / needs a decision

None.

### Round (fix round 1)

**Findings fixed**

- **Finding 1 (must-fix) — focus lost on close for the two invisible-anchor
  menus.** Fixed in the shared `Menu` (`apps/web/src/components/ui/menu.tsx`),
  so both `ChatActionsMenu` and `MessageActionsMenu` (point and non-point) are
  covered without touching the row/bubble files. The trigger is now ref'd; a
  `useLayoutEffect` on `open` checks whether the anchor is a real tab stop
  (`triggerRef.current.tabIndex >= 0`) and, only for a non-focusable anchor
  (the invisible `aria-hidden` span), captures `document.activeElement` before
  Radix moves focus into the content. `Content.onCloseAutoFocus` then
  `preventDefault()`s and focuses the captured opener, mirroring
  `ui/dialog.tsx:57-70`. Focusable triggers keep Radix's own trigger-focus
  return untouched (its `activeElement` at open is not the trigger anyway,
  because Radix preventDefaults the opening pointerdown), so the three
  acceptance menus are unaffected. An `onInteractOutside` flag skips the
  restore when the menu was dismissed by a click/focus elsewhere (that
  interaction already owns focus), matching the old hand-rolled behaviour of
  restoring on Escape only.

  No test added: the finding names none, the spec says "No tests (UI)" and
  `AGENTS.md` rules UI code out of tests; a test file is also not in the task's
  Allowed files, so adding one would fail the gate's scope check.

**Findings not fixed (nits, per instructions)**

- Findings 2 and 3 are nits and are not in lines this round changes, so they are
  left as they are.

**Gate**

```
gate: 13 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.2s)
PASS  lint  (0.7s)
PASS  typecheck  (2.5s)
PASS  effect  (0.5s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

No single test file was run (none near the change).

### Round 2 (Base UI port, Julio 2026-10-14)

**Dependency**

- Pinned `@base-ui/react` `1.8.0` in `apps/web/package.json` and `pnpm-lock.yaml`
  (newest at least two weeks old, checked with `npm view`).
- Peers: `react`, `react-dom` and `@types/react` `^17||^18||^19` are already in
  the workspace. `date-fns`/`@date-fns/tz` are **optional**
  (`peerDependenciesMeta`), so they were not added.
- `radix-ui` is left in `package.json` on purpose: T-1350 owns its removal and
  the Dialog/Sheet/Button it still serves. A rebase conflict there is expected.

**`ui/menu.tsx` on Base UI**

- `Menu.Root` (controlled `open` / `onOpenChange`) → `Menu.Trigger` (`render`
  prop takes the existing opener element) → `Menu.Portal` → `Menu.Positioner`
  (`side`, `align`, `sideOffset`, `collisionPadding={8}`, `z-50`) → `Menu.Popup`
  (`aria-label`, panel look `rounded-xl border border-border-strong bg-surface
  py-1 shadow-lg min-w-[180px]`, plus
  `max-h-[var(--available-height)] overflow-y-auto`).
- Items: `MenuItem`/`MenuEntry`/`MenuRadioItem` now use Base UI
  `Item`/`RadioItem` with `onClick` (the prop is still called `onSelect`) and
  `data-[highlighted]`/`data-[disabled]` styles unchanged. `MenuRadioGroup`
  keeps `value`/`onValueChange`. `MenuRadioItem`'s `closeOnClick` defaults to
  `true` so a picked option closes the menu (the fixture relied on Radix's
  close-on-select); the other call sites also close themselves.

**Anchors (which one, where)**

- Real openers (AttachMenu, NewChatButton, ChatHeader, ChatListMenu, OwnerMenu,
  StatusMenu, ContactsPage, both fixture menus) pass the button as `trigger` →
  `Menu.Trigger render`.
- `ChatActionsMenu` and `MessageActionsMenu` (no point) have no opener of their
  own — their ⋯ button lives in a parent — so the shared `Menu` renders an
  invisible positioned `<span>` from the new `anchorClassName` prop and hands
  its ref to `Positioner.anchor`. Same `absolute top-6 right-0`/`left-0` spot as
  before, `sideOffset={0}`.
- The right-click point in `MessageActionsMenu` uses `Positioner`'s **`anchor`**
  with a **virtual element** (`{ getBoundingClientRect }` at `{x, y}`, via the
  new `point` prop) — **not** Base UI `ContextMenu`; Radix's old `side="bottom"`,
  `align="start"`, `sideOffset={0}` are kept and `collisionPadding={8}` keeps it
  in the viewport near an edge.

**Round-1 focus fix (kept)**

- Base UI restores focus itself: for a programmatic open (no trigger pressed,
  `openMethod` stays `null`) it returns focus to the previously focused element,
  which is the row/bubble ⋯ button; for a real trigger it returns focus to the
  button. So the invisible-anchor menus get focus back on the opener on Escape
  without a custom `finalFocus`, and the Radix-specific capture /
  `onCloseAutoFocus` code is gone.
- Escape no longer needs the `onEscapeKeyDown` `stopPropagation`: Base UI's
  dismiss handler already stops propagation by default (`escapeKeyBubbles` is
  false), so the event does not reach ChatShell's window listener.

**Call sites touched**

- `ChatActionsMenu.tsx` (span trigger → `anchorClassName`; the Mute… item uses
  `closeOnClick={false}` instead of `event.preventDefault()`),
  `MessageActionsMenu.tsx` (span trigger → `anchorClassName` / `point`). The
  other 8 render sites keep their `trigger` unchanged. No Radix imports remain
  in `ui/menu.tsx` or any of the 9 call sites (grep clean).

**Gate**

```
gate: 15 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.1s)
PASS  lint  (0.6s)
PASS  typecheck  (2.8s)
PASS  effect  (0.5s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

No single test file was run: the spec says "No tests (UI)" and the gate reports
no nearby test files for `@zilar/web`.

**Not verified by me (same as round 1)**

The Acceptance browser behaviours are the lead's headless check; I reasoned them
through from the Base UI API but did not run a browser.

**Spec note (not edited)**

The redirect said the Spec's title and library rule were updated to Base UI. The
front-matter title is updated, but the "Library rule" paragraph still reads
Radix; per `AGENTS.md` I did not touch the Spec.

### Round 3 (lead fix round)

The lead's headless check passed. Two small items fixed:

1. **Every message-menu item now has an icon** (`components/MessageActionsMenu.tsx`),
   matching the mobile sheet (`apps/mobile/src/components/chat/message-actions-sheet.tsx`):
   Reply → `Reply`, Edit → `Pencil`, Copy text → `Copy`, Delete → `Trash2`,
   Unpin → `PinOff`, Pin → `Pin`. Forward/Select/Download already had `Forward`,
   `ListChecks` and `Download`.
2. **Stale "Radix" wording removed**: `MessageActionsMenu.tsx` (the `point`
   comment now says Base UI) and `NewChatButton.tsx` (the trigger comment now
   says Base UI). A grep for `radix` across `ui/menu.tsx`, the fixture and all 9
   call sites is clean.

Gate:

```
gate: 15 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.4s)
PASS  lint  (0.8s)
PASS  typecheck  (3.1s)
PASS  effect  (0.7s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Round 4 (findings fix round)

**Findings fixed**

- **Finding 1 (must-fix) — "Clear history" confirm never appears.** Added
  `closeOnClick={false}` to the Clear history `MenuItem`
  (`apps/web/src/components/ChatActionsMenu.tsx:166`), so Base UI no longer
  closes and unmounts the menu (and the `ConfirmDialog` it renders) before the
  confirm appears.
- **Finding 2 (must-fix) — Pin/Mute/Archive save errors silently swallowed.**
  Added `closeOnClick={false}` to the `MenuItem` inside `PrefMenuItem`
  (`ChatActionsMenu.tsx:55`). A failed save now keeps the menu open so the
  `role="alert"` sentence shows; a successful save still closes through the
  existing `onDone(false)` → `onClose()` path.

**Findings not fixed (nit, per instructions)**

- Finding 3 (OwnerMenu id lookup) is a nit and is not on a line this round
  changes, so it is left as it is.

**Tests added**

None. Both findings name no test and the Spec says "No tests (UI)"; `AGENTS.md`
rules UI code out of tests, and a test file is not in the task's Allowed files,
so adding one would fail the gate's scope check.

**Gate**

```
gate: 15 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (1.3s)
PASS  lint  (0.7s)
PASS  typecheck  (2.8s)
PASS  effect  (0.7s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

No single test file was run (none near the change).

### Disagreements

None.

## Review (written by Claude)

**Lead, 2026-10-14: approved. The packet is current for `b85f99e2` after 2 auto rounds and 2 lead rounds (Radix → Base UI redirect; icons and stale wording).**
- **Lead's headless web mock checks:**
  - the attach menu opens above the composer, Escape closes it, and focus returns to Attach;
  - the "Chat menu" ArrowDown moves to "Pinned messages";
  - right-click opens the message menu at the cursor and flips into view, and every item now has an icon;
  - "Clear history" opens its confirm (round-2 fix).
- **The remaining should-fix is declined:** reacting from the menu closes it, as on Telegram and on mobile.
- **Follow-up:** the first three chat-menu items (Pinned messages, Media, Chat background) have no icons.
