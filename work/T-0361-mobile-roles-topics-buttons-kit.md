---
id: T-0361
title: "Mobile kit migration: the Group roles sheet, the topic sheets and the task strip use the kit Button"
status: merged
milestone: M5
branch: task/T-0361-mobile-roles-topics-buttons-kit
model: auto
effort: low
depends_on: [T-0354]
estimate: 0.3 day
---

# T-0361: roles, topic sheets and task strip buttons on the kit

## Spec (written by Claude, do not edit)

### Why
This is the same migration as T-0343 to T-0355, for three more chat components.

### Verified facts (do not re-derive)
- **The `Pressable`s to migrate** (the line is the `<Pressable`; the label is its `accessibilityLabel`):
  - `apps/mobile/src/components/chat/group-roles-sheet.tsx`: 120 "Retry…", 159 `` `Save…` ``, 205 `` `Assign…` ``, 283 "Add…"
  - `apps/mobile/src/components/chat/topic-sheets.tsx`: 272 "Retry…", 296 `` `Remove…` ``, 312 "Retry…", 326 `` `Add…` ``, 348 "Add…"
  - `apps/mobile/src/components/chat/task-strip.tsx`: 233 "Save…"
- **Leave alone:** `topic-sheets.tsx:364` (the `Approvers:` row). It is a picker row, not a text pill.
- **Variant rule,** taken from each `Pressable`'s current look:
  - `bg-accent` → `default`;
  - `border border-border-strong` → `outline`;
  - plain (`active:bg-surface-raised`, no fill) → `ghost`;
  - `bg-destructive` → `destructive`.

  Size is `default`, or `sm` for small `py-1`/`py-1.5` pills. Keep layout classes (`mt-*`, `self-start`, `flex-1`, `shrink-0`) as `className`.
- **Labels:** every label must be inside `<Text>…</Text>`. A bare string child renders nothing on device; T-0349 shipped blank buttons this way. Icons inside a `default` button use `ACCENT_FOREGROUND[scheme]`.
- **Tests that reach these files** (the lead grepped importers: `app/group/[id].tsx` and `app/chat/[id].tsx`, and no test imports either one):
  - `apps/mobile/src/components/chat/group-roles-sheet.test.tsx`, `group-roles-mounted.test.tsx`, `group-roles-load.test.tsx`, `topic-actions-sheet.test.tsx` and `topic-sheets-roles.test.tsx` (all in `apps/mobile/src/components/chat/`).
  - Add mocks only, as in T-0353 and T-0355: `Platform.select`, reanimated `useReducedMotion`, `TextClassContext`, the `@/lib/depth` key exports, and `@/components/ui/use-key-press` when a test calls a body as a plain function or forces `useState` in order.

### What to build
1. Replace the ten `Pressable`s with the kit `Button` (`apps/mobile/src/components/ui/button.tsx`), using the variant rule. Keep:
   - every `accessibilityLabel`, `disabled` and `onPress`;
   - the visible text and busy text, each inside `<Text>`;
   - the icons.

   Drop the old pill classes and the child `Text` colour and size classes.
2. Import `Button`. Remove `Pressable` from an import only if it becomes unused.
3. Tests: mock changes only.
4. In the Report, list each button with its variant and size.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the transitive test mocks pitfall), `work/T-0355-mobile-invite-links-buttons-kit.md` (Report), `work/T-0356-mobile-profile-button-labels.md`, `apps/mobile/src/components/ui/button.tsx`, the three files and the tests.

### Allowed files
`apps/mobile/src/components/chat/group-roles-sheet.tsx`, `apps/mobile/src/components/chat/topic-sheets.tsx`, `apps/mobile/src/components/chat/task-strip.tsx`; mocks only: `apps/mobile/src/components/chat/group-roles-sheet.test.tsx`, `apps/mobile/src/components/chat/group-roles-mounted.test.tsx`, `apps/mobile/src/components/chat/group-roles-load.test.tsx`, `apps/mobile/src/components/chat/topic-actions-sheet.test.tsx`, `apps/mobile/src/components/chat/topic-sheets-roles.test.tsx`; and `work/T-0361-mobile-roles-topics-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot group-roles topic-actions-sheet topic-sheets
pnpm gate
```

### Acceptance
- The ten `Pressable`s render through `Button`, with every label inside `<Text>`.
- Tests pass, with mock changes only.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status:** done, ready for review.

**What I did**
Replaced the ten hand-rolled pill `Pressable`s with the kit `Button` (`components/ui/button.tsx`), per the variant rule. Every label is inside `<Text>`; kept every `accessibilityLabel`, `disabled` and `onPress`; dropped old pill classes and child `Text` colour/size classes; dropped `accessibilityRole="button"` since kit `Button` sets `role="button"` (T-0353/T-0355 pattern). `Pressable` stays imported in all three source files (other `Pressable`s remain: cancel/rename/delete rows, checkboxes, picker rows, approver row, status/owner/link chips).

Button list (variant / size / kept className):
- `group-roles-sheet.tsx` "Retry loading roles" → `outline` / default (omitted) / `self-start`.
- `group-roles-sheet.tsx` "Save …" → `outline` / `sm` / none.
- `group-roles-sheet.tsx` "Assign …" → `outline` / `sm` / none.
- `group-roles-sheet.tsx` "Add role" → default (omitted) / default (omitted) / `shrink-0`; busy text `Saving…` kept.
- `topic-sheets.tsx` "Retry loading topic roles" → `outline` / default / `self-start`.
- `topic-sheets.tsx` "Remove … from the topic" → `outline` / `sm` / none.
- `topic-sheets.tsx` "Retry loading group roles" → `outline` / default / `self-start`.
- `topic-sheets.tsx` "Add … to the topic" (picker row) → `outline` / `sm` / none.
- `topic-sheets.tsx` "Add roles to the topic" → default / default / `self-start`.
- `task-strip.tsx` "Save link" → default / `sm` / none.
- Left alone: `topic-sheets.tsx` Approvers picker row, "Done adding roles", Leave/Archive, and all group-roles cancel/confirm/checkbox rows.

Tests, mocks only (T-0353/T-0355 pattern): added `Platform.select` to the `react-native` mock, a `react-native-reanimated` `useReducedMotion` mock, and `TextClassContext` on the text mock in all five test files; plus a `@/components/ui/use-key-press` mock in `topic-actions-sheet.test.tsx` (it walks the tree by calling bodies as plain functions, so the real hook would throw invalid-hook-call). No `@/lib/depth` mock needed (no test mocks it; the real module is type-only RN import + tokens and loads cleanly).

**Files changed**
- `apps/mobile/src/components/chat/group-roles-sheet.tsx` — 4 `Pressable`s now kit `Button`s; `Button` imported.
- `apps/mobile/src/components/chat/topic-sheets.tsx` — 5 `Pressable`s now kit `Button`s; `Button` imported.
- `apps/mobile/src/components/chat/task-strip.tsx` — 1 `Pressable` now kit `Button`; `Button` imported.
- Mocks only: `group-roles-sheet.test.tsx`, `group-roles-mounted.test.tsx`, `group-roles-load.test.tsx`, `topic-actions-sheet.test.tsx`, `topic-sheets-roles.test.tsx`.
- `work/T-0361-mobile-roles-topics-buttons-kit.md` — status and this Report.

**Commands run and results**
- `pnpm install` (worktree) — succeeded (`Done in 22.8s`).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot group-roles topic-actions-sheet topic-sheets` — `Test Files 5 passed (5)`, `Tests 25 passed (25)` (only the usual string-mock casing warnings on stderr, incl. `TextClassContextProvider`).
- `pnpm gate` (repo root) — passed first try:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (22.1s)
  PASS  lint  (1.2s)
  PASS  typecheck  (17.3s)
  PASS  tests @zilar/mobile  (3.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Deviations from the spec:** none.

**Blocked / needs a decision:** none.

**Security checklist:** no secrets, routes, deletes, caps, permissions, or audit entries touched — UI button migration only; `disabled`/`busy` guards unchanged.

## Review (written by Claude)

**Approved** (pre-review clean, 1 nit accepted: a long role name in the topic add-picker no longer truncates to one line; check on the emulator). The ten buttons are kit `Button`s, and the lead scan found every label inside `<Text>`. The tests changed mocks only.
