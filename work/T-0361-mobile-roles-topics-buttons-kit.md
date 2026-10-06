---
id: T-0361
title: "Mobile kit migration: the Group roles sheet, the topic sheets and the task strip use the kit Button"
status: todo
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

## Review (written by Claude)
