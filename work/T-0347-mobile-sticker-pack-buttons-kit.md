---
id: T-0347
title: "Mobile kit migration: the text pill buttons in the Sticker pack editor use the kit Button"
status: todo
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

## Review (written by Claude)
