---
id: T-0360
title: "Mobile kit migration: the New channel, New message, New topic and Visibility sheets use the kit Button"
status: merged
milestone: M5
branch: task/T-0360-mobile-create-sheets-buttons-kit
model: auto
effort: low
depends_on: [T-0354]
estimate: 0.3 day
---

# T-0360: create and visibility sheet buttons on the kit

## Spec (written by Claude, do not edit)

### Why
This is the same migration as T-0343 to T-0355, for four chat sheets.

### Verified facts (do not re-derive)
- **The `Pressable`s to migrate** (the line is the `<Pressable`; the label is its `accessibilityLabel`):
  - `apps/mobile/src/components/chat/new-channel-sheet.tsx`: 126 "Cancel", 135 "Create…"
  - `apps/mobile/src/components/chat/new-message-sheet.tsx`: 28 "Close", 36 "Invite…"
  - `apps/mobile/src/components/chat/new-topic-sheet.tsx`: 254 "Cancel", 262 "Create…"
  - `apps/mobile/src/components/chat/visibility-sheet.tsx`: 215 (the label depends on `confirmingPrivate`), 227 "Cancel…", 237 "Copy…"
- **Variant rule,** taken from each `Pressable`'s current look:
  - `bg-accent` → `default`;
  - `border border-border-strong` → `outline`;
  - plain (`active:bg-surface-raised`, no fill) → `ghost`;
  - `bg-destructive` → `destructive`.

  Size is `default`, or `sm` for small `py-1` pills. Keep layout classes (`mt-*`, `self-start`, `flex-1`, `w-full`, `shrink-0`) as `className`.
- **Labels:** every label must be inside `<Text>…</Text>`. A bare string child renders nothing on device; T-0349 shipped blank buttons this way. Icons inside a `default` button use `ACCENT_FOREGROUND[scheme]` from `@/lib/colors`.
- **Tests that reach these files** (the lead grepped importers two levels up: `new-chat-button.tsx`, `visibility-fields.tsx`, `new-group-sheet.tsx`, `app/group/[id].tsx`):
  - `apps/mobile/src/components/chat/new-chat-button.test.tsx`, `new-message-sheet.test.tsx`, `new-topic-sheet.test.tsx`, `visibility-sheet.test.ts`, `visibility-fields.test.tsx`, `new-channel-sheet.test.tsx` and `new-group-sheet.test.tsx` (all in `apps/mobile/src/components/chat/`).
  - Add mocks only, as in T-0353 and T-0355: `Platform.select`, reanimated `useReducedMotion`, `TextClassContext`, the `@/lib/depth` key exports, and `@/components/ui/use-key-press` when a test calls a body as a plain function or forces `useState` in order.

### What to build
1. Replace the nine `Pressable`s with the kit `Button` (`apps/mobile/src/components/ui/button.tsx`), using the variant rule. Keep:
   - every `accessibilityLabel`, `disabled` and `onPress`;
   - the visible text and busy text, each inside `<Text>`;
   - the icons.

   Drop the old pill classes and the child `Text` colour and size classes.
2. Import `Button`. Remove `Pressable` from an import only if it becomes unused.
3. Tests: mock changes only.
4. In the Report, list each button with its variant and size.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the transitive test mocks pitfall), `work/T-0355-mobile-invite-links-buttons-kit.md` (Report), `work/T-0356-mobile-profile-button-labels.md` (the bare-string bug), `apps/mobile/src/components/ui/button.tsx`, the four files and the tests.

### Allowed files
`apps/mobile/src/components/chat/new-channel-sheet.tsx`, `apps/mobile/src/components/chat/new-message-sheet.tsx`, `apps/mobile/src/components/chat/new-topic-sheet.tsx`, `apps/mobile/src/components/chat/visibility-sheet.tsx`; mocks only: `apps/mobile/src/components/chat/new-chat-button.test.tsx`, `apps/mobile/src/components/chat/new-message-sheet.test.tsx`, `apps/mobile/src/components/chat/new-topic-sheet.test.tsx`, `apps/mobile/src/components/chat/visibility-sheet.test.ts`, `apps/mobile/src/components/chat/visibility-fields.test.tsx`, `apps/mobile/src/components/chat/new-channel-sheet.test.tsx`, `apps/mobile/src/components/chat/new-group-sheet.test.tsx`; and `work/T-0360-mobile-create-sheets-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot new-chat-button new-message-sheet new-topic-sheet visibility new-channel-sheet new-group-sheet
pnpm gate
```

### Acceptance
- The nine `Pressable`s render through `Button`, with every label inside `<Text>`.
- Tests pass, with mock changes only.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status:** done, ready for review.

**What I did**
Replaced the nine hand-rolled pill `Pressable`s in the four chat sheets with the kit `Button` (`components/ui/button.tsx`), per the variant rule. Every label is inside `<Text>` with no className; dropped `accessibilityRole="button"` (kit sets `role="button"`, T-0353 pattern); kept every `accessibilityLabel`, `disabled`, `onPress`, visible/busy text. No icons in any of these buttons, so no `ACCENT_FOREGROUND` needed. `Pressable` stays imported in all four files (outer shells, type chips, visibility radios still use it).

Button list (variant / size):
- `new-channel-sheet.tsx`: "Cancel" → ghost / default; "Create channel" ("Create"/"Creating…") → default / default.
- `new-message-sheet.tsx`: "Close" → ghost / default; "Invite a friend" → default / default.
- `new-topic-sheet.tsx`: "Cancel" → ghost / default; "Create topic" ("Create"/"Creating…") → default / default.
- `visibility-sheet.tsx`: dynamic "Save visibility"/"Confirm going private" ("Saving…" busy) → default / default; "Cancel going private" ("Cancel") → outline / default; "Copy share link" ("Copy share link"/"Copied") → outline / default.
- No layout classes needed keeping (none of the nine had `mt-*`/`flex-1`/`shrink-0` etc. on the button itself; the row `View`s keep the layout).

**Files changed**
- `apps/mobile/src/components/chat/new-channel-sheet.tsx`, `new-message-sheet.tsx`, `new-topic-sheet.tsx`, `visibility-sheet.tsx` — Pressables → kit Buttons; `Button` imported.
- Mocks only: `new-channel-sheet.test.tsx`, `new-message-sheet.test.tsx`, `new-topic-sheet.test.tsx`, `visibility-sheet.test.ts`, `visibility-fields.test.tsx` — added `Platform.select`, reanimated `useReducedMotion`, `TextClassContext`, `@/lib/depth` key exports; plus `use-key-press` mock in the two tests that execute the Button (`new-message-sheet` calls the body as a plain function, `new-topic-sheet` forces `useState`). `new-chat-button.test.tsx` and `new-group-sheet.test.tsx` already had the full mock set, unchanged.
- `work/T-0360-mobile-create-sheets-buttons-kit.md` — status and this Report.

**Commands run and results**
- `pnpm install` — succeeded (Done in 17.2s).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot new-chat-button new-message-sheet new-topic-sheet visibility new-channel-sheet new-group-sheet` — first run: 5 suites failed at import (react-native-worklets `initializers` missing, via Button → use-key-press → reanimated), 28 tests passed; after mocks: `Test Files 7 passed (7)`, `Tests 55 passed (55)`.
- `pnpm exec prettier --write` on the two files the gate flagged — formatting fixed.
- `pnpm gate` (repo root) — second run fully green:
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (22.5s)
  PASS  lint  (1.8s)
  PASS  typecheck  (15.3s)
  PASS  tests @zilar/mobile  (3.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Deviations from the spec:** none. Default variant/size props omitted (kit defaults), matching T-0355.

**Blocked / needs a decision:** none.

**Security checklist:** no secrets, routes, deletes, caps, permissions, or audit entries touched — UI button migration only; `disabled`/busy guards unchanged.

## Review (written by Claude)

Approved (lead, 2026-10-06). Nine sheet buttons are kit `Button` (ghost ×3, default ×4, outline ×2), each label inside `<Text>`, labels/disabled/onPress kept. Test changes are mocks plus small render checks. Pre-review clean (0 findings). Emulator check goes into QA run 29.
