---
id: T-0353
title: "Mobile kit migration: the New group sheet step buttons and the Explore join button use the kit Button"
status: todo
milestone: M5
branch: task/T-0353-mobile-new-group-explore-buttons-kit
model: auto
effort: low
depends_on: [T-0352]
estimate: 0.2 day
---

# T-0353: New group sheet and Explore buttons on the kit

## Spec (written by Claude, do not edit)

### Why
This is the same migration as T-0343 to T-0352. It handles the last text pill buttons with an accent fill outside the kit on mobile, except the group FAB (`app/group/[id].tsx:588`, an icon-only floating key, left for later).

### Verified facts (do not re-derive)
- **The five `Pressable`s** (the line is the `<Pressable`):

| File | Line | Label | Look today | Kit variant and size | Keep on Button |
| --- | --- | --- | --- | --- | --- |
| `apps/mobile/src/components/chat/new-group-sheet.tsx` | 225 | "Cancel" | plain `rounded-full px-4 py-2` | `ghost`, `default` | |
| `apps/mobile/src/components/chat/new-group-sheet.tsx` | 234 | "Next" | `rounded-full bg-accent px-4 py-2` | `default`, `default` | |
| `apps/mobile/src/components/chat/new-group-sheet.tsx` | 278 | "Back" | plain `rounded-full px-4 py-2` | `ghost`, `default` | |
| `apps/mobile/src/components/chat/new-group-sheet.tsx` | 287 | "Create group" | `rounded-full bg-accent px-4 py-2` | `default`, `default` | |
| `apps/mobile/src/app/explore.tsx` | 285 | `` `${exploreActionTitle(item)} ${item.title}` `` (text "Joining…" while busy) | `shrink-0 rounded-full bg-accent px-4 py-1.5` | `default`, `sm` | `className="shrink-0"` |

- **Leave alone:** the dialog card wrapper (`new-group-sheet.tsx:192`) and the contact rows (208).
- **Tests that reach these files** (the lead grepped importers two levels up):
  - `apps/mobile/src/components/chat/new-group-sheet.test.tsx` has no `Platform`, reanimated or `TextClassContext` mocks;
  - `apps/mobile/src/components/chat/new-chat-button.test.tsx` renders `NewGroupSheet` through `new-chat-button.tsx:11`. It mocks `Platform: { OS: 'ios' }` without `select` (line 26), and has a reanimated mock (line 37).
  - The next level, `app/(tabs)/index.tsx`, has no test.
  - No test imports `app/explore.tsx`.
  - Add mocks only, as in T-0348 and T-0351: `Platform.select`, reanimated `useReducedMotion`, `TextClassContext`, the `@/lib/depth` key exports if `@/lib/depth` is mocked, and `@/components/ui/use-key-press` if the test forces `useState` in order.

### What to build
1. Replace the five `Pressable`s with the kit `Button`, using the table. Keep:
   - every `accessibilityLabel`, `disabled` and `onPress`;
   - the visible text and busy text;
   - the layout class.

   Drop the old pill classes and the child `Text` colour and size classes.
2. Import `Button` in both files. Remove `Pressable` from an import only if it becomes unused.
3. Tests: mock changes only.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the transitive test mocks pitfall), `work/T-0351-mobile-auth-buttons-kit.md` (Report), `apps/mobile/src/components/ui/button.tsx`, the two files and the two tests.

### Allowed files
`apps/mobile/src/components/chat/new-group-sheet.tsx`, `apps/mobile/src/app/explore.tsx`; mocks only: `apps/mobile/src/components/chat/new-group-sheet.test.tsx`, `apps/mobile/src/components/chat/new-chat-button.test.tsx`; and `work/T-0353-mobile-new-group-explore-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot new-group-sheet new-chat-button
pnpm gate
```

### Acceptance
- The five `Pressable`s render through `Button`.
- Tests pass, with mock changes only.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
