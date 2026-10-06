---
id: T-0282
title: "Web kit: a right-side Sheet for the chat panels (PinsPanel first), and kit Escape stops at the topmost dialog"
status: todo
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
   - share the logic with `Dialog` (for example a small hook in `ui/`) instead of copying it.
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

## Review (written by Claude)
