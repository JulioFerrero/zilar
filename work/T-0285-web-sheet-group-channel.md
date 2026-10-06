---
id: T-0285
title: "Web kit migration: GroupPanel and ChannelPanel render through the kit Sheet"
status: merged
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

### What I did

- `GroupPanel.tsx` now renders through the kit `Sheet`:
  - `<Sheet open onClose={onClose} ariaLabel={`${chat.title} info`}>` replaces
    the outer `role="dialog"` backdrop and the inner panel div. The accessible
    name is unchanged;
  - removed the capture-phase Escape effect, the narrow-layout Tab-trap effect,
    the `FOCUSABLE` selector, `panelRef`, `isWide` and the `useMediaQuery` /
    `useRef` imports. The headers, sections, texts and behaviour are unchanged.
- `ChannelPanel.tsx`: same change; the `Sheet` gets
  `ariaLabel={`${chat.title} channel info`}`.
- Tests:
  - `GroupPanel.test.tsx`: kept the existing "closes on Escape" test and added
    "closes only the topmost dialog on Escape". GroupPanel's only kit `Dialog`
    is the avatar crop dialog inside `AvatarUploader`, which is not reachable in
    jsdom by itself; the test stubs the global `Image` so a file pick reaches
    the crop dialog, presses Escape and asserts the crop dialog closes while the
    panel and its `onClose` are untouched. So this test was **not** skipped.
  - `Channels.test.tsx`: added "closes the channel panel on Escape".
  - `InviteLinksSection.test.tsx` and `ChatView.test.tsx` were unchanged; they
    query by `region` and by the dialog's accessible name, both of which the
    `Sheet` keeps.

Files changed (all inside Allowed files):
`apps/web/src/components/GroupPanel.tsx`,
`apps/web/src/components/ChannelPanel.tsx`,
`apps/web/src/components/GroupPanel.test.tsx`,
`apps/web/src/components/Channels.test.tsx`,
`work/T-0285-web-sheet-group-channel.md`.

### Commands and results

- `pnpm install` → done, all 13 workspace projects.
- Checks test command:
  `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot GroupPanel Channels InviteLinksSection ChatView`
  → `Test Files 4 passed (4)`, `Tests 40 passed (40)`.
- `pnpm exec prettier --write` on the two panels and the two test files (a fix,
  run so `format:check` stays green; the task file is outside Prettier's scope).
- `pnpm gate` from the repo root:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (16.6s)
PASS  lint  (0.9s)
PASS  typecheck  (8.1s)
PASS  tests @zilar/web  (17.9s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Deviations / notes

- Because two wrapper divs disappear, the JSX body of both panels shifts one
  indentation level; `prettier --write` therefore rewrites most lines of the two
  files. The logic change is small; the large diff is whitespace only.
- The `Sheet` traps Tab on every width and moves focus to the first focusable
  child on open, like the kit `Dialog`. The panels previously did that only on
  the narrow layout (`isWide === false`). This is the intended shared-kit
  behaviour from T-0282 and both panels' tests pass.
- `TopicPanel` and `AiPanel` (T-0286) were not touched.

### Open questions

None.

## Review (written by Claude)

Approved. The pre-review was clean (0 nits) and needed no fix rounds.
- Neither panel keeps its own Escape handler, Tab trap or `role="dialog"`.
- Most of the diff is re-indentation.
- Tab is now trapped at every width. That fits, because the panels were already full-screen overlays with a backdrop.
- The lead checks the panels in the browser after the merge.
