---
id: T-0399
title: "Mobile kit: the Integrations, Machines and Stickers settings screens' loading and error states use StateMessage"
status: merged
milestone: M5
branch: task/T-0399-mobile-settings-states-b
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0399: settings states on the kit (Integrations, Machines, Stickers)

## Spec (written by Claude, do not edit)

### Why
This is the same migration as T-0398, on three more screens.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ui/state-message.tsx`:**
  - `StateMessage({ kind, title, hint?, icon?, action?: { label, onPress, accessibilityLabel? }, size? })`;
  - `loading` is a labelled spinner plus the title;
  - `error` has the alert role, a red icon and the title;
  - the action is a kit accent `Button size="sm"`.
- **The blocks:**

| File | Loading line | Loading text | Error line | Retry label |
| --- | --- | --- | --- | --- |
| `apps/mobile/src/app/settings/integrations.tsx` | 94 | "Loading integrations…" (line 97) | 110 | "Retry loading integrations" |
| `apps/mobile/src/app/settings/machines.tsx` | 277 | "Loading machines…" (line 280) | 284 | "Retry loading machines" |
| `apps/mobile/src/app/settings/stickers.tsx` | 294 | "Loading stickers…" (line 297) | 301 | "Retry loading stickers" |

  Each loading block is an `ActivityIndicator` (some with `color={ACCENT[scheme]}`) and a muted `Text`. Each error block is an alert `Text` and a Retry button.
- **Leave alone:** the Stickers screen's Discover loading and error states (lines ~447-470, "Retry loading shared packs"). They sit inside a tab section with their own layout.
- **Tests:**
  - `apps/mobile/src/components/integrations/integrations-screen.test.tsx`;
  - `apps/mobile/src/components/machines/machines-screen.test.tsx`;
  - `apps/mobile/src/components/stickers/stickers-screen.test.tsx`.

  Keep the texts and labels.

### What to build
1. In each screen, replace the loading block with `<StateMessage kind="loading" title="<same text>" />`.
2. Replace the error block with `<StateMessage kind="error" title={<the same error text expression>} action={{ label: 'Retry', accessibilityLabel: '<same label>', onPress: <same handler> }} />`. If the error block shows extra content beyond the text and Retry (for example a hint or a second line), pass it as `hint` or keep it below.
3. Drop imports only if they become unused.
4. Add mocks only where tests need them. Change no assertion.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/state-message.tsx`, each screen around the lines above, and the three tests.

### Allowed files
`apps/mobile/src/app/settings/integrations.tsx`, `apps/mobile/src/app/settings/machines.tsx`, `apps/mobile/src/app/settings/stickers.tsx`, `apps/mobile/src/components/integrations/integrations-screen.test.tsx`, `apps/mobile/src/components/machines/machines-screen.test.tsx`, `apps/mobile/src/components/stickers/stickers-screen.test.tsx`, `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx` (mocks only; lead, 2026-10-06), `work/T-0399-mobile-settings-states-b.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot integrations-screen machines-screen stickers-screen
pnpm gate
```

### Acceptance
- The three main loading and error blocks are `StateMessage`s with the same texts and labels.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Status: **review** — done. `pnpm gate` is green and its scope line names no file outside the Allowed files.

### What I did
- Replaced the three main loading blocks with `<StateMessage kind="loading" title="…" />` and the three error blocks with `<StateMessage kind="error" title={…} action={{ label: 'Retry', accessibilityLabel: '…', onPress: reload }} />`, keeping the same texts and retry labels:
  - `apps/mobile/src/app/settings/integrations.tsx` — “Loading integrations…” / `errorInfo.message` + “Retry loading integrations”.
  - `apps/mobile/src/app/settings/machines.tsx` — “Loading machines…” / `errorInfo.message` + “Retry loading machines”.
  - `apps/mobile/src/app/settings/stickers.tsx` — “Loading stickers…” / `LOAD_ERROR` + “Retry loading stickers”.
- Dropped imports that became unused: `ActivityIndicator`, `ACCENT` and `RefreshCw` in `integrations.tsx`; `ACCENT` and `RefreshCw` in `machines.tsx`; none in `stickers.tsx` (its Discover block still uses `ActivityIndicator`, `ACCENT` and `RefreshCw`).
- Left the Stickers Discover loading and error blocks (`~447-470`) untouched.
- Added only the mocks `StateMessage` needs, changing no assertion:
  - In the three allowed tests: `DANGER` in the `@/lib/colors` mock of all three; `MUTED_FOREGROUND` additionally in `machines-screen.test.tsx`; `CircleAlert` and `Inbox` in the `lucide-react-native` mock of all three.
  - In `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx` (added to Allowed files by the lead, mocks only): `CircleAlert` and `Inbox` in its lucide mock. This test was collateral — `sticker-pack.tsx` imports `favoriteTileSize` from `./stickers`, so that test’s module graph now loads `state-message.tsx`.

Files changed (8, all in Allowed files): the three screens, four tests, this task file.

### Commands and real results
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot integrations-screen machines-screen stickers-screen` → **32 passed (3 files)**.
- `pnpm gate` (run 1) → `PASS install (frozen)`, `FAIL format` (`apps/mobile/src/app/settings/machines.tsx`, `apps/mobile/src/app/settings/stickers.tsx`). Fixed with `pnpm exec prettier --write` on just those two files.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot sticker-pack-screen` → **11 passed (1 file)** (after the mock fix below).
- `pnpm gate` (run 2, before the mock fix) → `FAIL tests @zilar/mobile`: 11/11 tests in `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx` (`No "Inbox" export is defined on the "lucide-react-native" mock`), not in my three tests.
- `pnpm gate` (final):
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (13.6s)
  PASS  lint  (0.6s)
  PASS  typecheck  (6.3s)
  PASS  tests @zilar/mobile  (1.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Notes
- No assertions changed, no dependencies added, no secrets touched, and the Stickers Discover loading/error states (`~447-470`) were left alone.
- The only file outside the originally listed Allowed files was `sticker-pack-screen.test.tsx`; the lead widened the scope for mocks only, which is exactly the two entries added.

## Review (written by Claude)

**2026-10-06, lead:** approved. The pre-review was clean.
- All three screens now use StateMessage, with the same texts and retry labels.
- The Discover states are untouched.
- The test changes are mocks only.
- `sticker-pack-screen.test.tsx` was allowed by the lead after a valid block: it reaches `stickers.tsx` through `sticker-pack.tsx`, a transitive import that the spec missed.
