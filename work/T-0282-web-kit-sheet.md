---
id: T-0282
title: "Web kit: a right-side Sheet for the chat panels (PinsPanel first), and kit Escape stops at the topmost dialog"
status: merged
milestone: M5
branch: task/T-0282-web-kit-sheet
model: auto
effort: low
depends_on: [T-0280]
estimate: 0.4 day
---

# T-0282: kit Sheet + Escape propagation

## Spec (written by Claude, do not edit)

### Why
Five chat side panels still hand-roll the same right-side drawer shell, each with its own backdrop, Escape handler and focus code:
- `components/GroupPanel.tsx:324`
- `components/PinsPanel.tsx:118`
- `components/TopicPanel.tsx:437`
- `components/ChannelPanel.tsx:317`
- `components/ais/AiPanel.tsx:484`

This task adds a kit `Sheet` and moves `PinsPanel` onto it. A later task moves the other four.

It also fixes an Escape problem in the kit `Dialog`. `apps/web/src/routes/ChatShell.tsx:32-40` adds a **window** keydown listener: on a narrow layout (< 900 px) with a chat open, Escape navigates to `/`. The kit `Dialog` handles Escape on **document** (`apps/web/src/components/ui/dialog.tsx:66-82`) but does not stop the event. The event then bubbles to window, so on a phone-width layout, closing a kit dialog with Escape inside a chat probably also leaves the chat. The panels avoid this with a capture-phase listener plus `event.stopPropagation()` (`components/PinsPanel.tsx:39-50`).

### Verified facts (do not re-derive)
- **Kit `Dialog`** (`apps/web/src/components/ui/dialog.tsx`):
  - focus moves in and returns on close (lines 52-64);
  - the topmost-only Escape is at lines 66-82: `document.querySelectorAll('[role="dialog"]')`, last one equal to `panelRef.current`;
  - the Tab trap is at lines 88-108;
  - the backdrop click uses `dismissable` (line 112);
  - the panel carries `role="dialog"`, `aria-modal`, `aria-label` / `aria-labelledby`.
- **`PinsPanel`** (`apps/web/src/components/PinsPanel.tsx`, 230 lines):
  - capture-phase Escape at lines 39-50;
  - its own Tab trap on narrow layouts only, with `isWide = useMediaQuery('(min-width: 900px)')`, at lines 52-82;
  - the shell at lines 117-128: outer `role="dialog"` with `aria-label={`Pinned messages in ${chat?.title ?? 'this chat'}`}`, `fixed inset-0 z-40 flex justify-end bg-black/40`; inner panel `h-full w-full sm:w-[380px] bg-surface shadow-xl`;
  - its own header: Pin icon, title "Pinned messages", count line, and a Close button with `aria-label="Close pinned messages"`.
  - It is rendered from `apps/web/src/routes/ChatView.tsx:137`.
  - Tests: `apps/web/src/components/PinnedMessages.test.tsx` lines 375 and 400 query `getByRole('dialog', { name: 'Pinned messages in …' })`.
- **`ChatShell` tests:** `apps/web/src/routes/ChatShell.test.tsx`.

### What to build
1. **Kit Escape stops at the dialog.** When the kit `Dialog` handles an Escape (it is topmost and dismissable), it calls `event.stopPropagation()`, so the window listener in `ChatShell` does not also run.
   - Test in `apps/web/src/components/ui/kit.test.tsx`: a `window` keydown spy is not called when Escape closes a dialog, and is called when no dialog is open.
2. **Kit `Sheet`** in `apps/web/src/components/ui/sheet.tsx`, plus `sheet.fixture.tsx`:
   - a right-side drawer with the same behaviour as `Dialog`: topmost-only Escape that stops propagation, focus in and back, Tab trap, backdrop click, `dismissable`, `ariaLabel`, `initialFocusRef`;
   - layout from today's panels: full height, `w-full sm:w-[380px]`, `bg-surface`, a `bg-black/40` backdrop;
   - **no built-in header**: children render the panel content, because each panel has its own header;
   - share the logic with `Dialog` (for example a small hook in `ui/use-modal.ts`) instead of copying it;
   - attach the Escape listener and the initial focus in a `useLayoutEffect`, not `useEffect`. T-0280 found that Escape can be lost between the commit and a passive effect; see its Report. The `GroupHandleRoute` tests must still pass.
   - Kit tests: Escape closes; Escape in a `Dialog` opened on top of a `Sheet` closes only the `Dialog`; backdrop click closes; `dismissable={false}` blocks both.
3. **`PinsPanel` on the `Sheet`:**
   - delete its own Escape effect, Tab-trap effect and shell markup;
   - keep the header, the list, the texts and the accessible name;
   - the tests in `PinnedMessages.test.tsx` keep passing;
   - add one test that Escape closes the panel.
4. **Cosmos:** the `fixtures.test.tsx` check picks up `sheet.fixture.tsx` with no extra work; make sure it passes.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/PinsPanel.tsx`, `apps/web/src/components/PinnedMessages.test.tsx`, `apps/web/src/routes/ChatShell.tsx`.

### Allowed files
`apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/sheet.tsx`, `apps/web/src/components/ui/sheet.fixture.tsx`, `apps/web/src/components/ui/use-modal.ts`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/PinsPanel.tsx`, `apps/web/src/components/PinnedMessages.test.tsx`, `work/T-0282-web-kit-sheet.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit PinnedMessages ChatShell fixtures
pnpm gate
```

### Acceptance
- `PinsPanel.tsx` has no `role="dialog"` and no keydown listener of its own.
- A kit `Dialog` or `Sheet` Escape no longer reaches window listeners. All existing dialog tests still pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
`GroupPanel`, `TopicPanel`, `ChannelPanel`, `AiPanel` (the next task); `StickerPanel`.

---

## Report (written by the worker when done)

### What I did

- Added `apps/web/src/components/ui/use-modal.ts`: one `useModal` hook shared by
  `Dialog` and `Sheet`. It moves focus in on open and back on close, attaches the
  topmost-only Escape listener that calls `event.stopPropagation()` before
  `onClose()`, and returns the Tab-trap `onKeyDown`. Both effects use
  `useLayoutEffect`, so an Escape arriving right after the commit is not lost
  (the T-0280 race).
- `apps/web/src/components/ui/dialog.tsx` now calls `useModal` and dropped its
  own `useEffect`s, local Tab handler and `FOCUSABLE` copy. Escape now stops
  propagation, so it no longer reaches `ChatShell`'s window listener.
- Added `apps/web/src/components/ui/sheet.tsx`: a right-side drawer (`fixed
  inset-0 z-40 flex justify-end bg-black/40`; panel `h-full w-full bg-surface
  shadow-xl sm:w-[380px]`), with `role="dialog"`, `aria-modal`, `ariaLabel`,
  `dismissable`, `initialFocusRef` and no built-in header. It shares `useModal`
  with `Dialog`.
- Added `apps/web/src/components/ui/sheet.fixture.tsx` (default, accessible
  name, not dismissable, initial focus, long body), picked up by
  `fixtures.test.tsx` via `import.meta.glob`.
- `apps/web/src/components/PinsPanel.tsx` now renders inside `Sheet`: removed its
  Escape effect, narrow-layout Tab-trap effect, `FOCUSABLE`, `panelRef`,
  `useMediaQuery` and the hand-rolled shell. Header, list, texts and the
  `Pinned messages in …` accessible name are unchanged.
- Tests: in `kit.test.tsx` a Dialog Escape stops before a `window` keydown spy
  while it closes (and the spy fires once with no dialog); a new `Sheet` suite
  (Escape closes, a Dialog over a Sheet closes only the Dialog, backdrop click
  and Tab trap, `dismissable={false}` blocks both, focus returns, closed renders
  nothing). In `PinnedMessages.test.tsx`, a new test closes the panel with
  Escape.

Files changed (all inside Allowed files):
`apps/web/src/components/ui/use-modal.ts` (new),
`apps/web/src/components/ui/sheet.tsx` (new),
`apps/web/src/components/ui/sheet.fixture.tsx` (new),
`apps/web/src/components/ui/dialog.tsx`,
`apps/web/src/components/ui/kit.test.tsx`,
`apps/web/src/components/PinsPanel.tsx`,
`apps/web/src/components/PinnedMessages.test.tsx`,
`work/T-0282-web-kit-sheet.md`.

### Commands and results

- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit PinnedMessages ChatShell fixtures`
  → `Test Files 4 passed (4)`, `Tests 128 passed (128)`.
- `pnpm gate` from the repo root:

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (11.1s)
PASS  lint  (0.8s)
PASS  typecheck  (6.7s)
PASS  tests @zilar/web  (22.1s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Deviations / notes

- I kept `Dialog`'s `FOCUSABLE` selector (`button, [href], …` without
  `:not([disabled])`) in the shared hook, so Dialog's Tab behaviour is byte-for-
  byte the same. `PinsPanel` previously excluded disabled buttons; the only
  disabled control is the transient "Unpinning…" button and no test depends on
  the difference.
- `PinsPanel` is only mounted while open (`ChatView.tsx:136-138`), so it passes
  `open` as a constant `true`; close is driven by `onClose` like before.
- I ran `prettier --write` on the seven changed/added source files so
  `format:check` stays green; no whole-suite checks were run before `pnpm gate`.

### Open questions

None.

### Fix round 1

- `ui/use-modal.ts`: the Escape listener now attaches whenever a modal is open,
  not only when `dismissable`. When the panel is the topmost `[role="dialog"]`
  it always calls `event.stopPropagation()`; it calls `onClose()` only when
  `dismissable`. An undismissable modal therefore neither closes nor lets Escape
  reach window listeners (ChatShell's narrow-layout handler). New kit test:
  `keeps an undismissable dialog open and still stops Escape before window
  listeners` (asserts open, no close, window spy not called).
- `ui/sheet.fixture.tsx`: the `WithoutHeader` variant now uses an
  `OpenPlainSheet` wrapper that renders `Sheet` with children only, so its name
  matches what it shows (no header). `fixtures.test.tsx` still passes.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit PinnedMessages
  GroupHandleRoute fixtures` → `Test Files 4 passed (4)`, `Tests 135 passed
  (135)`.
- `pnpm gate` from the repo root:

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (20.3s)
PASS  lint  (0.7s)
PASS  typecheck  (6.7s)
PASS  tests @zilar/web  (23.0s)
scope: every changed file is inside the Allowed files
GATE PASS
```

## Review (written by Claude)

**Approved** after one lead fix round.

**What changed:**
- `use-modal.ts` now holds the shared logic for `Dialog` and `Sheet`: focus and the Escape listener are attached in layout effects, which closes the T-0280 race;
- the topmost modal swallows Escape (`stopPropagation`), so ChatShell's narrow-layout window handler no longer leaves the chat;
- `PinsPanel` is on the `Sheet`, with no keydown listener of its own.

**Fix round 1:**
- an undismissable modal also swallows Escape, without closing;
- the `WithoutHeader` fixture now renders children only.

**Next:** the other four panels (Group, Topic, Channel, AI) move to the `Sheet` in a follow-up task.
