---
id: T-0346
title: "Mobile kit migration: the text pill buttons on the Stickers screen use the kit Button"
status: todo
milestone: M5
branch: task/T-0346-mobile-stickers-buttons-kit
model: auto
effort: low
depends_on: [T-0345]
estimate: 0.2 day
---

# T-0346: Stickers screen buttons on the kit

## Spec (written by Claude, do not edit)

### Why
This is the same migration as T-0343 (Machines) and T-0345 (Connections), for the Stickers screen.

### Verified facts (do not re-derive)
- **The eight text pill `Pressable`s in `apps/mobile/src/app/settings/stickers.tsx`** (the line is the `<Pressable`):

| Line | Label | Look today | Kit variant | Keep on Button |
| --- | --- | --- | --- | --- |
| 320 | "Retry loading stickers" (icon) | `rounded-full border border-border-strong` | `outline` | |
| 336 | "Create a new sticker pack" (icon) | `rounded-full bg-accent` | `default` | |
| 371 | "Open Discover" | `rounded-full bg-accent` | `default` | |
| 411 | `Edit ${pack.title}` (`Pencil` icon in `ICON[scheme]`) | `rounded-full border border-border-strong` | `outline` | |
| 427 | `Remove ${pack.title}` (My packs) | `rounded-full border border-border-strong` | `outline` | |
| 476 | "Retry loading shared packs" (icon) | `rounded-full border border-border-strong` | `outline` | |
| 503 | `Remove ${pack.title}` (Discover) | `shrink-0 rounded-full border border-border-strong` | `outline` | `className="shrink-0"` |
| 513 | `Add ${pack.title}` | `shrink-0 rounded-full bg-accent` | `default` | `className="shrink-0"` |

- **Leave these alone:**
  - the segment tabs (286);
  - the full-width "Import from Telegram" tile (347, `h-11 rounded-xl`);
  - the icon-only move up/down buttons (388, 398);
  - the "Remove favorite" overlay (568).
- **An icon inside a kit `Button` that is `default` (accent):** draw it in `ACCENT_FOREGROUND[scheme]` (`@/lib/colors`), as T-0341 does, if it is not already.
- **Test mocks:**
  - `apps/mobile/src/components/stickers/stickers-screen.test.tsx` mocks `react-native` with `Platform: { OS: 'ios' }` (line 32, no `select`) and `@/components/ui/text` as `{ Text }` only (line 58).
  - `Button` needs `TextClassContext`, `Platform.select` and `react-native-reanimated`'s `useReducedMotion`. Copy the T-0345 mock additions in `apps/mobile/src/components/connections/connections-screen.test.tsx`, mocks only.
  - If `@/lib/colors` is mocked and you use `ACCENT_FOREGROUND`, add it.

### What to build
1. Replace the eight `Pressable`s with `<Button variant=… size="sm">`, using the table. Keep:
   - every `accessibilityLabel`, `disabled` and `onPress`;
   - the visible text, busy text, icons and their colours (accent-foreground on the `default` ones).

   Drop the old pill classes and the child `Text` colour and size classes. Keep `shrink-0` where the table says.
2. Import `Button` from `@/components/ui/button`.
3. Test: mock changes only, so that the existing assertions pass.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the transitive test mocks pitfall), `work/T-0345-mobile-connections-buttons-kit.md` (Report), `apps/mobile/src/components/ui/button.tsx`, `apps/mobile/src/app/settings/stickers.tsx:280-530` and `apps/mobile/src/components/stickers/stickers-screen.test.tsx`.

### Allowed files
`apps/mobile/src/app/settings/stickers.tsx`; mocks only: `apps/mobile/src/components/stickers/stickers-screen.test.tsx`; and `work/T-0346-mobile-stickers-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot stickers-screen
pnpm gate
```

### Acceptance
- The eight buttons render through `Button`.
- Tests pass, with mock changes only.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
