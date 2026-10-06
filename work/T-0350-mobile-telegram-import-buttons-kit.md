---
id: T-0350
title: "Mobile kit migration: the text pill buttons in the Telegram import sheet use the kit Button"
status: todo
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

## Review (written by Claude)
