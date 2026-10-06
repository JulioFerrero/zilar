---
id: T-0285
title: "Web kit migration: GroupPanel and ChannelPanel render through the kit Sheet"
status: todo
milestone: M5
branch: task/T-0285-web-sheet-group-channel
model: auto
effort: low
depends_on: [T-0282]
estimate: 0.3 day
---

# T-0285: Group and Channel panels on the kit Sheet

## Spec (written by Claude, do not edit)

### Why
T-0282 added the kit `Sheet` (`apps/web/src/components/ui/sheet.tsx`) and moved `PinsPanel` onto it. Read `work/T-0282-web-kit-sheet.md` (Report) and the current `apps/web/src/components/PinsPanel.tsx` for the pattern.

The `Sheet`, through `ui/use-modal.ts`:
- handles Escape topmost-only and stops it from reaching window listeners;
- runs the Tab trap, focus in and back, and the backdrop click;
- takes the props `open`, `onClose`, `ariaLabel`, `children`, `initialFocusRef?` and `dismissable?`.

One more gain: the panels' own capture-phase Escape handlers fire before anything else. Today, if a kit `Dialog` is open on top of a panel (for example an invite dialog), Escape closes the panel underneath too. With the `Sheet`, only the topmost modal closes.

### Verified facts (do not re-derive)
- **`apps/web/src/components/GroupPanel.tsx`** (917 lines):
  - capture-phase Escape effect at lines 230-242;
  - narrow-layout Tab trap effect with `isWide` (line 49) at lines 244-273;
  - shell at lines 323-334: outer `role="dialog"`, `aria-label={`${chat.title} info`}`, inner `h-full w-full … bg-surface shadow-xl outline-none sm:w-[380px]`.
- **`apps/web/src/components/ChannelPanel.tsx`** (618 lines):
  - Escape effect at lines 202-212;
  - Tab trap with `isWide` (line 44) at lines 214-243;
  - shell at lines 316-327, `aria-label={`${chat.title} channel info`}`.
- **Tests that render them:**
  - `apps/web/src/components/GroupPanel.test.tsx`;
  - `apps/web/src/components/Channels.test.tsx`;
  - `apps/web/src/components/InviteLinksSection.test.tsx`;
  - `apps/web/src/routes/ChatView.test.tsx`.

### What to build
1. Both panels render through `Sheet`:
   - `ariaLabel` keeps today's accessible name;
   - delete their own Escape effects, Tab-trap effects and the `isWide` / `useMediaQuery` use if nothing else needs it;
   - delete the backdrop and shell markup;
   - keep the headers, sections, texts and behaviour.
2. Tests:
   - existing tests keep passing, changed only where they relied on the old markup;
   - add a test per panel that Escape closes it;
   - for `GroupPanel`, add a test that Escape with a kit `Dialog` open on top closes only the `Dialog`. Use any dialog the panel already opens; if none is reachable in tests, say so in the Report and skip this one test.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/sheet.tsx`, `apps/web/src/components/ui/use-modal.ts`, `apps/web/src/components/PinsPanel.tsx`, `work/T-0282-web-kit-sheet.md` (Report), and the two panels with their tests.

### Allowed files
`apps/web/src/components/GroupPanel.tsx`, `apps/web/src/components/GroupPanel.test.tsx`, `apps/web/src/components/ChannelPanel.tsx`, `apps/web/src/components/Channels.test.tsx`, `apps/web/src/components/InviteLinksSection.test.tsx`, `apps/web/src/routes/ChatView.test.tsx`, `work/T-0285-web-sheet-group-channel.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot GroupPanel Channels InviteLinksSection ChatView
pnpm gate
```

### Acceptance
- Neither panel contains `role="dialog"` or a keydown listener of its own. Texts and behaviour are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
`TopicPanel` and `AiPanel` (T-0286, running at the same time; do not touch them).

---

## Report (written by the worker when done)

## Review (written by Claude)
