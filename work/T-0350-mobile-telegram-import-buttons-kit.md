---
id: T-0350
title: "Mobile kit migration: the text pill buttons in the Telegram import sheet use the kit Button"
status: merged
milestone: M5
branch: task/T-0350-mobile-telegram-import-buttons-kit
model: auto
effort: low
depends_on: [T-0349]
estimate: 0.2 day
---

# T-0350: Telegram import sheet buttons on the kit

## Spec (written by Claude, do not edit)

### Why
This is the same migration as T-0343 and T-0345 to T-0349, for the Telegram sticker import sheet.

### Verified facts (do not re-derive)
- **The seven text pill `Pressable`s in `apps/mobile/src/components/stickers/telegram-import-sheet.tsx`** (the line is the `<Pressable`):

| Line | Label | Look today | Kit variant |
| --- | --- | --- | --- |
| 162 | "Close" | `rounded-full bg-accent px-5 py-2` | `default` |
| 178 | "Close" | `rounded-full bg-accent px-5 py-2` | `default` |
| 218 | "Import again" | `rounded-full border border-border-strong px-4 py-2` | `outline` |
| 230 | "Done" | `rounded-full border border-border-strong px-4 py-2` | `outline` |
| 239 | "Open pack" | `rounded-full bg-accent px-5 py-2` | `default` |
| 319 | "Cancel" | plain `rounded-full px-4 py-2` | `ghost` |
| 328 | "Import" | `rounded-full bg-accent px-5 py-2` | `default` |

- **Leave alone:** the backdrop "Dismiss import" (124) and the icon-only "Close" (142).
- **Tests that reach this file** (the lead grepped one level up):
  1. `apps/mobile/src/components/stickers/telegram-import-sheet.test.tsx`:
     - mocks `react-native` with `Platform: { OS: 'ios' }`, with no `select` (line 25);
     - mocks `@/lib/depth` (line 75);
     - has no reanimated or `TextClassContext` mocks.
  2. `apps/mobile/src/components/stickers/stickers-screen.test.tsx` and `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx` render it through `apps/mobile/src/app/settings/stickers.tsx`.
     - They already mock `Platform.select`, reanimated and `TextClassContext` (T-0346).
     - `sticker-pack-screen.test.tsx` also mocks the depth key exports (T-0347).
     - `stickers-screen.test.tsx` may need `primaryKey`, `KEY_PRIMARY_PRESSED_SHADOW` and `pressStyle` if it mocks `@/lib/depth` and now reaches a `default` Button.

  Copy the mocks-only pattern from T-0347 and T-0348 where needed. If a test forces `useState` values in order, mock `@/components/ui/use-key-press` as T-0348 did in `integrations-screen.test.tsx`.
- **The kit `Button`:** `apps/mobile/src/components/ui/button.tsx`, size `sm`.

### What to build
1. Replace the seven `Pressable`s with `<Button variant=… size="sm">`, using the table. Keep:
   - every `accessibilityLabel`, `disabled` and `onPress`;
   - the visible text and busy text.

   Drop the old pill classes and the child `Text` colour and size classes.
2. Import `Button`.
3. Tests: mock changes only.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the transitive test mocks pitfall), `work/T-0348-mobile-integrations-requests-buttons-kit.md` (Report), `apps/mobile/src/components/ui/button.tsx`, `apps/mobile/src/components/stickers/telegram-import-sheet.tsx` and the three tests.

### Allowed files
`apps/mobile/src/components/stickers/telegram-import-sheet.tsx`; mocks only: `apps/mobile/src/components/stickers/telegram-import-sheet.test.tsx`, `apps/mobile/src/components/stickers/stickers-screen.test.tsx`, `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx`; and `work/T-0350-mobile-telegram-import-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot telegram-import-sheet stickers-screen sticker-pack-screen
pnpm gate
```

### Acceptance
- The seven `Pressable`s render through `Button`.
- Tests pass, with mock changes only.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status:** done, ready for review.

**What I did**
Replaced the seven text pill `Pressable`s in `apps/mobile/src/components/stickers/telegram-import-sheet.tsx` with the kit `Button` (`apps/mobile/src/components/ui/button.tsx`), size `sm` for every one, matching the spec table:

- "Close" in the not-set-up state (was line 162) → `variant="default"`, kept `accessibilityLabel="Close"` and `onPress={close}`.
- "Close" in the token-rejected state (was 178) → `variant="default"`, kept `accessibilityLabel="Close"` and `onPress={close}`.
- "Import again" in the partial result (was 218) → `variant="outline"`, kept `accessibilityLabel="Import again"`, `disabled={busy}`, `onPress={() => run(input)}` and the busy text `busy ? 'Importing…' : 'Import again'`.
- "Done" on the result card (was 230) → `variant="outline"`, kept `accessibilityLabel="Done"`, `disabled={busy}`, `onPress={done}`.
- "Open pack" on the result card (was 239) → `variant="default"`, kept `accessibilityLabel="Open pack"`, `disabled={busy}`, `onPress={openPack}`.
- "Cancel" on the form (was 319) → `variant="ghost"`, kept `accessibilityLabel="Cancel"`, `disabled={busy}`, `onPress={close}`.
- "Import" on the form (was 328) → `variant="default"`, kept `accessibilityLabel="Import"`, `disabled={busy}`, `onPress={() => run(input)}` and the busy text `busy ? 'Importing…' : 'Import'`.

For every button I dropped the old pill classes and the child `Text` colour/size classes; the kit `TextClassContext` now sets them. I dropped `accessibilityRole="button"` because the kit `Button` sets `role="button"` on its own `Pressable` (the T-0345/T-0346/T-0347/T-0348 pattern). Added `import { Button } from '@/components/ui/button';` and kept the `Pressable` import, which is still used by the two `Pressable`s the spec says to leave alone (backdrop "Dismiss import" at 124 and the icon-only "Close" at 142).

**Files changed**
- `apps/mobile/src/components/stickers/telegram-import-sheet.tsx` — seven `Pressable`s now kit `Button`s; `Button` imported.
- `apps/mobile/src/components/stickers/telegram-import-sheet.test.tsx` — mocks only: added `Platform.select`, the `react-native-reanimated` `useReducedMotion` mock, `TextClassContext` on the `@/components/ui/text` mock, and `primaryKey`, `KEY_PRIMARY_PRESSED_SHADOW`, `pressStyle` to the `@/lib/depth` mock.
- `work/T-0350-mobile-telegram-import-buttons-kit.md` — status and this Report.

**Why the mock changes**
The kit `Button` chain pulls in `@/components/ui/use-key-press` (which calls `useReducedMotion`), `@/lib/depth` (`primaryKey`, `KEY_PRIMARY_PRESSED_SHADOW`, `pressStyle`) and `TextClassContext` from `@/components/ui/text`, plus `Platform.select` at module scope in `button.tsx`'s `cva` calls. `telegram-import-sheet.test.tsx` mocked none of those. The `use-key-press` hook itself did **not** need its own mock: that test's `useState` mock returns `forcedBusy` for every boolean initial with a noop setter, so the extra `useState(false)` the hook adds renders correctly and does not shift the sheet's string/null cursors (the parent's hooks run before any child's, so `input` stays the first string and `result`/`special` keep their order).

I did **not** change `stickers-screen.test.tsx` or `sticker-pack-screen.test.tsx`: both already mock `Platform.select`, `react-native-reanimated` and `TextClassContext` (T-0346), and `sticker-pack-screen.test.tsx` already mocks the depth key exports (T-0347). `stickers-screen.test.tsx` does not mock `@/lib/depth`, but the real module loads fine in the test (type-only `react-native` import; already used by `stickers.tsx`), and the sheet renders through `apps/mobile/src/app/settings/stickers.tsx` without a depth mock. Both files passed unchanged.

**Commands run and results**
- `pnpm install` (worktree) — succeeded, `Done in 11.2s` (only the usual peer/deprecation warnings).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot telegram-import-sheet stickers-screen sticker-pack-screen` — `Test Files 3 passed (3)`, `Tests 41 passed (41)` (usual React DOM casing warnings on stderr only).
- `pnpm gate` (repo root) — final output:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (10.8s)
  PASS  lint  (0.8s)
  PASS  typecheck  (5.5s)
  PASS  tests @zilar/mobile  (1.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Deviations from the spec:** none. All mock additions are within the spec's listed pattern.

**Blocked / needs a decision:** none.

## Review (written by Claude)

**Approved** (pre-review clean, 0 nits). All seven pills are kit `Button`s with the variants from the table, and the lead grep found the labels kept. Only the sheet's own test needed mock changes; the two screen tests already had the Button mocks.
