---
id: T-0346
title: "Mobile kit migration: the text pill buttons on the Stickers screen use the kit Button"
status: merged
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
`apps/mobile/src/app/settings/stickers.tsx`; mocks only: `apps/mobile/src/components/stickers/stickers-screen.test.tsx`, `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx` (added by the lead after the worker's block: `sticker-pack.tsx:55` imports from `stickers.tsx`); and `work/T-0346-mobile-stickers-buttons-kit.md`.

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

**Status:** blocked — the code work is complete and correct, but `pnpm gate` cannot pass without one mock-only edit to a test file that is not in the Allowed files.

**What I did**
Replaced the eight text pill `Pressable`s in `apps/mobile/src/app/settings/stickers.tsx` with the kit `Button` (`size="sm"`), per the spec table:
- Retry loading stickers → `variant="outline"`, kept the `RefreshCw` icon at `ICON[scheme]` and the text "Retry";
- Create a new sticker pack → `variant="default"`, kept `disabled={busy}` and the `router.push`, kept the `Plus` icon now at `ACCENT_FOREGROUND[scheme]` (from `@/lib/colors`, matching T-0345) and the text "New pack";
- Open Discover → `variant="default"`, kept the `onPress` and text;
- `Edit ${pack.title}` → `variant="outline"`, kept `disabled={busy}`, the `router.push`, the `Pencil` icon at `ICON[scheme]` and the text "Edit";
- `Remove ${pack.title}` (My packs) → `variant="outline"`, kept `disabled={busy}`, `onPress={askRemove}` and the text;
- Retry loading shared packs → `variant="outline"`, kept the `RefreshCw` icon and text;
- `Remove ${pack.title}` (Discover) → `variant="outline"` with `className="shrink-0"`;
- `Add ${pack.title}` → `variant="default"` with `className="shrink-0"`, kept `disabled={busy}`, `onPress={addPack}` and the busy text ("Adding…" / "Add").

For every button I kept the `accessibilityLabel`, `disabled` and `onPress`; dropped the old pill `className` and the child `Text` colour/size classes (the kit's `TextClassContext` sets them); kept `shrink-0` on the two Discover ones. `accessibilityRole="button"` was dropped because the kit `Button` sets `role="button"` on its `Pressable` (the T-0345 pattern). I changed the import of `ACCENT_FOREGROUND` from `@/lib/depth` to `@/lib/colors` (the depth export is a plain string, the colors one is scheme-keyed, as the spec asks) and added `import { Button } from '@/components/ui/button';`. `Pressable` stays imported for the segment tabs, the Import tile, the two move buttons and the Remove-favorite overlay, which the spec says to leave alone.

**Files changed**
- `apps/mobile/src/app/settings/stickers.tsx` — eight `Pressable`s replaced with kit `Button`s; `Button` imported; `ACCENT_FOREGROUND` now from `@/lib/colors`.
- `apps/mobile/src/components/stickers/stickers-screen.test.tsx` — mocks only: added `select` to the `react-native` `Platform` mock, added the `react-native-reanimated` (`useReducedMotion`) mock, added `TextClassContext` to the `@/components/ui/text` mock, added `ACCENT_FOREGROUND` to the `@/lib/colors` mock.
- `work/T-0346-mobile-stickers-buttons-kit.md` — status and this Report.

**Commands run and results**
- `pnpm install` (worktree) — succeeded (`Done in 11.4s`).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot stickers-screen` — `Test Files 1 passed (1)`, `Tests 16 passed (16)`.
- `pnpm gate` (repo root) — **GATE FAIL**, 11 tests failed, all in `src/components/stickers/sticker-pack-screen.test.tsx`, with:
  ```
  Error: Cannot find module '.../react-native-worklets/lib/module/initializers/initializers'
  imported from '.../react-native-worklets/lib/module/index.js'
  ```
  Gate tail: `scope: every changed file is inside the Allowed files` / `GATE FAIL`.

**Root cause (transitive test mock, the LEAD_HANDOFF pitfall)**
`apps/mobile/src/app/settings/sticker-pack.tsx:55` does `import { favoriteTileSize } from './stickers'`, so `sticker-pack-screen.test.tsx` (which renders `sticker-pack`) transitively imports the just-migrated `stickers.tsx`. `stickers.tsx` now imports the kit `Button`, which pulls in `@/components/ui/use-key-press` → `react-native-reanimated`. That test's `react-native` mock has no `Platform`, so `Button`'s module-eval `Platform.select(...)` also throws; and it has no `react-native-reanimated` mock, so Node ESM then fails to resolve `react-native-worklets` (the same failure T-0345 fixed by mocking reanimated).

**Blocked / needs a decision**
The fix is mock-only but touches `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx`, which is not in the Allowed files, and the gate's scope check reads the Allowed files literally, so I did not edit it. Please either add `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx` to the Allowed files (mocks only) or perform the mock edit yourself. Based on the failure and the T-0345 pattern, that file needs:
- `Platform: { OS: 'ios', select: (options) => options['ios'] }` inside its existing `react-native` mock; and
- `vi.mock('react-native-reanimated', () => ({ useReducedMotion: () => false }));`.

Because that test only imports `stickers.tsx` for the `favoriteTileSize` helper and never renders `Button`, I believe those two are the minimum; adding `TextClassContext` to its `@/components/ui/text` mock and `ACCENT_FOREGROUND` to its `@/lib/colors` mock (the full T-0345 set) is the safer, consistent choice. Once the file is in scope I can make the edit and rerun `pnpm gate`.

**Round 2 (unblocked by the lead)**
The lead added `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx` (mocks only) to the Allowed files. In that file I added, mocks only: `Platform: { OS: 'ios', select: … }` to the `react-native` mock, the `react-native-reanimated` (`useReducedMotion`) mock, `TextClassContext` to the `@/components/ui/text` mock, and `ACCENT_FOREGROUND` to the `@/lib/colors` mock.

Commands and real results:
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot stickers-screen sticker-pack-screen` — `Test Files 2 passed (2)`, `Tests 27 passed (27)`.
- `pnpm gate` (repo root) — `GATE PASS`:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (11.2s)
  PASS  lint  (0.4s)
  PASS  typecheck  (4.9s)
  PASS  tests @zilar/mobile  (1.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

Status is now `review`. All four changed files are inside the Allowed files.

## Review (written by Claude)

**Approved** (pre-review clean, 0 nits, after one lead unblock). The eight text pills are kit `Button`s, with `shrink-0` kept on the two Discover buttons. The lead grep found all 8 keep their accessibility label.

The worker's block was valid, and it was a lead spec miss. `sticker-pack.tsx:55` imports from `stickers.tsx`, so `sticker-pack-screen.test.tsx` needed the same mocks. `docs/LEAD_HANDOFF.md` already says to grep one level up; the lead skipped it. Both test files changed mocks only.
