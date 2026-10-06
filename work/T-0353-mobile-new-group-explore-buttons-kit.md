---
id: T-0353
title: "Mobile kit migration: the New group sheet step buttons and the Explore join button use the kit Button"
status: merged
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

**Status:** done, ready for review.

**What I did**
Replaced the five hand-rolled accent-pill `Pressable`s with the kit `Button` (`apps/mobile/src/components/ui/button.tsx`), following the spec table:
- `apps/mobile/src/components/chat/new-group-sheet.tsx`: "Cancel" → `variant="ghost" size="default"`; "Next" → `variant="default" size="default"`; "Back" → `variant="ghost" size="default"`; "Create group" → `variant="default" size="default"` (busy text `Creating…` kept). Left the dialog card wrapper and contact rows alone, so `Pressable` stays in the import.
- `apps/mobile/src/app/explore.tsx`: join/open button → `variant="default" size="sm" className="shrink-0"`, busy text `Joining…` kept. Left the kind-filter radios, Retry and Show-more `Pressable`s alone, so `Pressable` stays in the import.
- Kept every `accessibilityLabel`, `disabled`, `onPress`, and the visible text in all five. Dropped the old pill classes and the child `Text` colour/size classes (kit `TextClassContext` sets them). Dropped `accessibilityRole="button"` since the kit `Button` sets `role="button"` (T-0348/T-0351 pattern).
- Tests, mocks only: `new-group-sheet.test.tsx` — added `Platform.select` to the `react-native` mock, a `react-native-reanimated` `useReducedMotion` mock, `TextClassContext` on the `@/components/ui/text` mock, the `@/lib/depth` key exports (`primaryKey`, `pressStyle`, `KEY_PRIMARY_PRESSED_SHADOW`, alongside the existing `ICON_COLOR`), and an `@/components/ui/use-key-press` mock. The `use-key-press` mock is needed here for a different reason than T-0351: this test calls the body as a plain function, so the real `Button`'s hook would throw an invalid-hook-call; the mock keeps the real `Button` rendering (labels, `disabled`, `onPress` all pass through to its inner `Pressable`, which the `collect`/`button`/`press` helpers find). `new-chat-button.test.tsx` — added `Platform.select` (the kit `Button` calls it at module init) and `TextClassContext`; its reanimated and `@/lib/depth` key mocks already existed, and no `useState` is forced there so no `use-key-press` mock was needed.

**Files changed**
- `apps/mobile/src/components/chat/new-group-sheet.tsx` — four `Pressable`s now kit `Button`s; `Button` imported.
- `apps/mobile/src/app/explore.tsx` — one `Pressable` now kit `Button`; `Button` imported.
- `apps/mobile/src/components/chat/new-group-sheet.test.tsx` — mocks only (see above).
- `apps/mobile/src/components/chat/new-chat-button.test.tsx` — mocks only (see above).
- `work/T-0353-mobile-new-group-explore-buttons-kit.md` — status and this Report.

**Commands run and results**
- `pnpm install` (worktree) — succeeded (`Done in 10.4s`).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot new-group-sheet new-chat-button` — `Test Files 2 passed (2)`, `Tests 28 passed (28)` (only the usual string-mock casing warnings on stderr). Re-ran after the prettier fix: same 28 passed.
- `pnpm gate` (repo root) — first run failed `format` (prettier wanted the short `<Button>` lines collapsed onto one line, the T-0352 pitfall); after `pnpm exec prettier --write` on the file, final output:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (11.2s)
  PASS  lint  (0.8s)
  PASS  typecheck  (5.8s)
  PASS  tests @zilar/mobile  (1.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Deviations from the spec:** none. One spec-note difference: the `use-key-press` mock in `new-group-sheet.test.tsx` is required by the plain-function render (invalid hook call otherwise), not by forced `useState` order — still mocks-only in an Allowed file.

**Blocked / needs a decision:** none.

**Security checklist:** no secrets, routes, deletes, caps, permissions, or audit entries touched — UI button migration only; `disabled`/`busy` guards unchanged.

## Review (written by Claude)

**Approved** (pre-review clean, 0 nits). The New group buttons are kit `Button`s: Cancel and Back `ghost`, Next and Create group `default`. They leave out `size`, so they get the default size, which matches the table. The Explore join button is `default` `sm` with `shrink-0`. The lead grep found the labels kept. Both tests changed mocks only.
