---
id: T-0347
title: "Mobile kit migration: the text pill buttons in the Sticker pack editor use the kit Button"
status: merged
milestone: M5
branch: task/T-0347-mobile-sticker-pack-buttons-kit
model: auto
effort: low
depends_on: [T-0346]
estimate: 0.2 day
---

# T-0347: Sticker pack editor buttons on the kit

## Spec (written by Claude, do not edit)

### Why
This is the same migration as T-0343, T-0345 and T-0346, for the Sticker pack editor.

### Verified facts (do not re-derive)
- **The five text pill `Pressable`s in `apps/mobile/src/app/settings/sticker-pack.tsx`** (the line is the `<Pressable`):

| Line | Label | Look today | Kit variant |
| --- | --- | --- | --- |
| 471 | "Retry loading pack" (icon) | `rounded-full border border-border-strong` | `outline` |
| 488 | "Back to stickers" | `rounded-full border border-border-strong` | `outline` |
| 726 | `Retry sticker ${index + 1}` | `rounded-full border border-border-strong` | `outline` |
| 766 | `isCreate ? 'Create pack' : 'Save'` (with busy text) | `rounded-full bg-accent px-5 py-2.5` | `default` |
| 777 | "Cancel" | plain `rounded-full px-4 py-2.5` | `ghost` |

- **Leave these alone:**
  - the visibility options at lines 518 and 549;
  - the icon overlays at 615 and 736;
  - the dashed "Add sticker images" tile at 627;
  - the full-width danger "Delete" button at 790.
- **Who reaches this file:**
  - the only test that imports `sticker-pack.tsx` is `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx`;
  - it already has the kit `Button` mocks since T-0346 (`Platform.select`, reanimated, `TextClassContext`, `ACCENT_FOREGROUND`);
  - `stickers.tsx` only names the route as a string, it does not import the file.
- **The kit `Button`** (`apps/mobile/src/components/ui/button.tsx`): variants `default`, `outline` and `ghost`, size `sm` (or `default` for the main Save and Cancel row if `sm` looks too small next to the full-width Delete; pick one and say which in the Report).

### What to build
1. Replace the five `Pressable`s with the kit `Button`, using the variants above. Keep:
   - every `accessibilityLabel`, `disabled` and `onPress`;
   - the visible text, busy text, icons and their colours. An icon inside a `default` button uses `ACCENT_FOREGROUND[scheme]`.

   Drop the old pill classes and the child `Text` colour and size classes.
2. Import `Button` from `@/components/ui/button`.
3. Test: mock changes only, and only if needed.

### Read first
`AGENTS.md`, `work/T-0346-mobile-stickers-buttons-kit.md` (Report), `apps/mobile/src/components/ui/button.tsx`, `apps/mobile/src/app/settings/sticker-pack.tsx:460-800` and `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx`.

### Allowed files
`apps/mobile/src/app/settings/sticker-pack.tsx`; mocks only: `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx`; and `work/T-0347-mobile-sticker-pack-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot sticker-pack-screen
pnpm gate
```

### Acceptance
- The five buttons render through `Button`.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status:** done, ready for review.

**What I did**
Replaced the five text pill `Pressable`s in `apps/mobile/src/app/settings/sticker-pack.tsx` with the kit `Button`, per the spec table:
- Retry loading pack (was 471) → `variant="outline"`, kept `onPress={load}` and the `RefreshCw` icon at `ICON[scheme]`, text "Retry";
- Back to stickers (was 488) → `variant="outline"`, kept `onPress={() => router.back()}` and the text;
- `Retry sticker ${index + 1}` (was 726) → `variant="outline"`, kept `disabled={saving}` and `onPress={() => retryItem(item.key)}`, text "Retry";
- Save / Create pack (was 766) → `variant="default"`, kept `disabled={saveDisabled}`, `onPress={save}` and the busy text ("Saving…" / "Create pack" / "Save");
- Cancel (was 777) → `variant="ghost"`, kept `disabled={saving}` and `onPress={onBack}`, text "Cancel".

For every button I kept the `accessibilityLabel`, `disabled` and `onPress`; dropped the old pill classes and the child `Text` colour/size classes (`text-[15px]`, `text-[14px]`, `font-medium`, `text-accent-foreground`, `text-muted-foreground`, `text-foreground`), which the kit's `TextClassContext` now sets. `accessibilityRole="button"` was dropped because the kit `Button` sets `role="button"` on its own `Pressable` (the T-0345/T-0346 pattern). All five use `size="sm"`; the spec allowed `size="default"` for the main Save/Cancel row, and I chose `sm` for consistency with the other settings screens migrated in T-0345 and T-0346. The visible icons keep their colours: the outline Retry uses `ICON[scheme]`. Added `import { Button } from '@/components/ui/button';`.

**Left alone (as the spec says):** the two visibility option `Pressable`s (now 519/550), the two icon overlays (616, 737), the dashed "Add sticker images" tile (628) and the full-width danger "Delete pack" button (789). `Pressable` therefore stays in the `react-native` import.

**Files changed**
- `apps/mobile/src/app/settings/sticker-pack.tsx` — five `Pressable`s replaced with kit `Button`s; `Button` imported.
- `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx` — mocks only: added `primaryKey`, `KEY_PRIMARY_PRESSED_SHADOW` and `pressStyle` to the existing `@/lib/depth` mock. These are needed because the screen now renders a `default` (key) `Button`, and the file previously mocked `@/lib/depth` as `{ well: {} }` only. (The `Platform.select`, reanimated, `TextClassContext` and `ACCENT_FOREGROUND` mocks T-0346 added were already sufficient.)
- `work/T-0347-mobile-sticker-pack-buttons-kit.md` — status and this Report.

**Commands run and results**
- `pnpm install` (worktree) — succeeded (`Done in 11.3s`; only pre-existing peer/deprecation warnings).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot sticker-pack-screen` — first run failed with `No "primaryKey" export is defined on the "@/lib/depth" mock` (9 failed, 2 passed); after the mocks-only `@/lib/depth` addition: `Test Files 1 passed (1)`, `Tests 11 passed (11)` (only the usual React DOM casing warnings on stderr).
- `pnpm gate` (repo root) — final output:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (11.4s)
  PASS  lint  (0.9s)
  PASS  typecheck  (5.7s)
  PASS  tests @zilar/mobile  (1.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Deviations from the spec:** none. I chose `size="sm"` for the main Save/Cancel row (the spec offered `sm` or `default` and asked me to say which); all five buttons are `sm`, matching T-0345/T-0346.

**Blocked / needs a decision:** none.

## Review (written by Claude)

**Approved** (pre-review clean, 1 nit accepted: the tests do not pin the variant or size, so these are checked by reading the code). The five text pills are kit `Button`s, size `sm`: Retry outline, Back outline, Retry sticker outline, Save/Create default, Cancel ghost. The lead grep found the labels kept. The test changes are mocks only.
