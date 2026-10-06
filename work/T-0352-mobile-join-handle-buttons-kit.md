---
id: T-0352
title: "Mobile kit migration: the buttons on the group invite-link screen and the public @handle screen use the kit Button"
status: merged
milestone: M5
branch: task/T-0352-mobile-join-handle-buttons-kit
model: auto
effort: low
depends_on: [T-0351]
estimate: 0.2 day
---

# T-0352: join and @handle screen buttons on the kit

## Spec (written by Claude, do not edit)

### Why
This is the same migration as T-0343 to T-0351, for the two link-landing screens.

### Verified facts (do not re-derive)
- **The six text pill `Pressable`s** (the line is the `<Pressable`):

| File | Line | Label | Look today | Kit variant and size | Keep on Button |
| --- | --- | --- | --- | --- | --- |
| `apps/mobile/src/app/join/[token].tsx` | 79 | "Choose a name" | `mt-5 items-center rounded-full bg-accent px-4 py-2.5` | `default`, `default` | `className="mt-5"` |
| `apps/mobile/src/app/at/[handle].tsx` | 138 | "Close" | `mt-5 rounded-full bg-accent px-4 py-2` | `default`, `default` | `className="mt-5"` |
| `apps/mobile/src/app/at/[handle].tsx` | 160 | "Retry" | `rounded-full bg-accent px-4 py-2` | `default`, `default` | |
| `apps/mobile/src/app/at/[handle].tsx` | 168 | "Close" | `rounded-full border border-border-strong px-4 py-2` | `outline`, `default` | |
| `apps/mobile/src/app/at/[handle].tsx` | 201 | `handleJoinLabel(view.entry)` (full width, with `disabled`) | `mt-5 w-full items-center rounded-full bg-accent px-4 py-2.5` | `default`, `lg` | `className="mt-5 w-full"` |
| `apps/mobile/src/app/at/[handle].tsx` | 212 | "Close" | `mt-3 rounded-full px-4 py-1.5` | `ghost`, `default` | `className="mt-3"` |

- **Tests:** no test imports either route file (the lead grepped for `join/[token]` and `at/[handle]` across `*.test.*`). So no test should need a change; if the gate shows one, add mocks only and name the file in the Report.
- **The kit `Button`:** `apps/mobile/src/components/ui/button.tsx`, sizes `default` (h-10) and `lg` (h-11).

### What to build
1. Replace the six `Pressable`s with the kit `Button`, using the table. Keep:
   - every `accessibilityLabel`, `disabled` and `onPress`;
   - the visible text;
   - the layout classes in the last column.

   Drop the old pill classes and the child `Text` colour and size classes.
2. Import `Button` in both files. Remove `Pressable` from an import only if it becomes unused.

### Read first
`AGENTS.md`, `work/T-0351-mobile-auth-buttons-kit.md` (Report), `apps/mobile/src/components/ui/button.tsx`, and the two files.

### Allowed files
`apps/mobile/src/app/join/[token].tsx`, `apps/mobile/src/app/at/[handle].tsx`, `work/T-0352-mobile-join-handle-buttons-kit.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The six `Pressable`s render through `Button`.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status:** done, ready for review.

**What I did**
Replaced the six hand-rolled accent-pill `Pressable`s with the kit `Button` (`apps/mobile/src/components/ui/button.tsx`), following the spec table:
- `apps/mobile/src/app/join/[token].tsx`: "Choose a name" → `variant="default" size="default" className="mt-5"`. No `Pressable` remains, dropped it from the import.
- `apps/mobile/src/app/at/[handle].tsx`: not-found "Close" → `default`/`default` `className="mt-5"`; "Retry" → `default`/`default` (no className); error "Close" → `outline`/`default`; join `handleJoinLabel(view.entry)` → `default`/`lg` `className="mt-5 w-full"`; ghost "Close" → `ghost`/`default` `className="mt-3"`. No `Pressable` remains, dropped it from the import.
- Kept every `accessibilityLabel`, `disabled`, `onPress`, and the visible text. Dropped the old pill classes and the child `Text` colour/size classes (kit `TextClassContext` sets them). Dropped `accessibilityRole="button"` since the kit `Button` sets `role="button"` (T-0348/T-0351 pattern).
- No test changes: confirmed no test imports either route file (grep for `join/[token]` and `at/[handle]` across `*.test.*` returned no matches).

**Files changed**
- `apps/mobile/src/app/join/[token].tsx` — one `Pressable` now kit `Button`; `Button` imported, unused `Pressable` import removed.
- `apps/mobile/src/app/at/[handle].tsx` — five `Pressable`s now kit `Button`s; `Button` imported, unused `Pressable` import removed.
- `work/T-0352-mobile-join-handle-buttons-kit.md` — status and this Report.

**Commands run and results**
- `pnpm install` (worktree) — succeeded (`Done in 10.9s`).
- `pnpm gate` (repo root) — two runs: first failed `format` (`prettier --check` flagged `apps/mobile/src/app/at/[handle].tsx` — I had wrapped two short `<Button>` lines that fit on one line); after collapsing them, final output:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (11.6s)
  PASS  lint  (0.7s)
  PASS  typecheck  (5.8s)
  PASS  tests @zilar/mobile  (1.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- No single-file tests run: the spec verifies no test imports either route file, and I confirmed that with grep.

**Deviations from the spec:** none.

**Blocked / needs a decision:** none.

## Review (written by Claude)

**Approved** (pre-review clean, 0 nits). The six buttons are kit `Button`s with the variant, size and layout class from the table; the lead grep found the labels kept. No test reaches these route files. The worker fell back from the free Muse to the paid Muse.
