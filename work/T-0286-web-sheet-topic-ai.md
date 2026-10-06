---
id: T-0286
title: "Web kit migration: TopicPanel and AiPanel render through the kit Sheet"
status: todo
milestone: M5
branch: task/T-0286-web-sheet-topic-ai
model: auto
effort: low
depends_on: [T-0282]
estimate: 0.3 day
---

# T-0286: Topic and AI panels on the kit Sheet

## Spec (written by Claude, do not edit)

### Why
T-0282 added the kit `Sheet` (`apps/web/src/components/ui/sheet.tsx`) and moved `PinsPanel` onto it. Read `work/T-0282-web-kit-sheet.md` (Report) and the current `apps/web/src/components/PinsPanel.tsx` for the pattern.

The `Sheet`, through `ui/use-modal.ts`:
- handles Escape topmost-only and stops it from reaching window listeners;
- runs the Tab trap, focus in and back, and the backdrop click;
- takes the props `open`, `onClose`, `ariaLabel`, `children`, `initialFocusRef?` and `dismissable?`.

### Verified facts (do not re-derive)
- **`apps/web/src/components/TopicPanel.tsx`** (1150 lines):
  - capture-phase Escape effect at lines 162-172;
  - narrow-layout Tab trap with `isWide` (line 55) at lines 174-204;
  - shell at lines 436-447: `role="dialog"`, `aria-label={`${chat.title} topic info`}`, inner `… bg-surface … sm:w-[380px]`.
  - Test: `apps/web/src/components/TopicPanel.test.tsx`.
- **`apps/web/src/components/ais/AiPanel.tsx`** (815 lines):
  - shell at lines 483-492: `role="dialog"`, `aria-label={`${chat.title} AI settings`}`, inner `h-full w-full max-w-sm … bg-background shadow-xl sm:w-[380px]`;
  - no Escape handler of its own (`grep Escape` finds none), so Escape does not close it today.
  - Test: `apps/web/src/components/ais/AiPanel.test.tsx`.
- `apps/web/src/components/TaskStrip.test.tsx` also queries panel dialogs by name.

### What to build
1. Both panels render through `Sheet`:
   - `ariaLabel` keeps today's accessible name;
   - delete `TopicPanel`'s own Escape and Tab-trap effects, and the `isWide` / `useMediaQuery` use if nothing else needs it;
   - delete both backdrops and shells;
   - keep headers, sections, texts and behaviour.
   - `Sheet` has no `className` prop (`ui/sheet.tsx` lines 4-14), so `AiPanel` takes the Sheet's `bg-surface`, like the other panels, instead of its old `bg-background`. This is intended.
   - `AiPanel` gains Escape-to-close, which is intended.
2. Tests:
   - existing tests keep passing, changed only where they relied on the old markup;
   - add a test per panel that Escape closes it.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/sheet.tsx`, `apps/web/src/components/ui/use-modal.ts`, `apps/web/src/components/PinsPanel.tsx`, `work/T-0282-web-kit-sheet.md` (Report), and the two panels with their tests.

### Allowed files
`apps/web/src/components/TopicPanel.tsx`, `apps/web/src/components/TopicPanel.test.tsx`, `apps/web/src/components/ais/AiPanel.tsx`, `apps/web/src/components/ais/AiPanel.test.tsx`, `apps/web/src/components/TaskStrip.test.tsx`, `work/T-0286-web-sheet-topic-ai.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot TopicPanel AiPanel TaskStrip
pnpm gate
```

### Acceptance
- Neither panel contains `role="dialog"` or a keydown listener of its own. Texts and behaviour are unchanged, apart from Escape now closing `AiPanel`.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
`GroupPanel` and `ChannelPanel` (T-0285, running at the same time; do not touch them). Do not change `ui/sheet.tsx`.

---

## Report (written by the worker when done)

## Review (written by Claude)
