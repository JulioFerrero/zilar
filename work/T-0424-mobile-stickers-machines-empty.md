---
id: T-0424
title: "Mobile kit: the Stickers packs and favorites empty states and the Machines empty state use StateMessage"
status: merged
milestone: M5
branch: task/T-0424-mobile-stickers-machines-empty
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0424: Stickers and Machines empty states on StateMessage (mobile)

## Spec (written by Claude, do not edit)

### Why
These are the last rows of batch 28 of `docs/audit/ui-kit-leftovers.md`.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ui/state-message.tsx`:** `StateMessage({ kind: 'empty', title, icon?: LucideIcon, action?: { label, onPress, accessibilityLabel? } })`. The block is centred with the icon (default Inbox) and the title, and the action is an accent `sm` Button with a text label only (no icon).
- **The empty states:**

| File | Lines | Today | Becomes |
| --- | --- | --- | --- |
| `apps/mobile/src/app/settings/stickers.tsx` | 333-344 | `View` with a `Sticker` icon (32), the text "No packs on your panel yet. Look in Discover for shared packs to add." and a default `sm` Button "Open Discover" (`accessibilityLabel="Open Discover"`, `onPress={() => openTab('discover')}`) | `StateMessage kind="empty" icon={Sticker} title="<same text>" action={{ label: 'Open Discover', accessibilityLabel: 'Open Discover', onPress: () => openTab('discover') }}` |
| `apps/mobile/src/app/settings/stickers.tsx` | 502-507 | `View` with the text "No favorites yet. Starred stickers show up here." | `StateMessage kind="empty" title="<same text>"` |
| `apps/mobile/src/app/settings/machines.tsx` | 299-312 | `View` with a `Server` icon (32), the text "No machines yet. Add one to let your AIs work on your own computers." and a default `sm` Button (`accessibilityLabel="Add a machine"`, `onPress={openAdd}`, a Plus icon and the text "Add machine") | `StateMessage kind="empty" icon={Server} title="<same text>" action={{ label: 'Add machine', accessibilityLabel: 'Add a machine', onPress: openAdd }}` |

- **Tests:**
  - `apps/mobile/src/components/stickers/stickers-screen.test.tsx` (lines 294-313 and 378 assert these texts and "Open Discover");
  - `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx` (it reaches `stickers.tsx` through `sticker-pack.tsx`; mocks only);
  - `apps/mobile/src/components/machines/machines-screen.test.tsx`: lines 201-203 assert "No machines yet", "Add machine", and `toMatch(/<Plus[^>]*color="#0a0a0a"/)`.
- **The one allowed assertion change:** the Plus assertion at `machines-screen.test.tsx:203` checks the button icon that this change removes, because the StateMessage action has no icon. Remove that single line, as T-0420 did for Connections. Change no other assertion.

### What to build
1. Apply the table.
2. Keep the conditions. Drop imports (`ACCENT_FOREGROUND`, `Plus`, `Sticker`, `Server`) only if they become unused; `Sticker` and `Server` are now passed as `icon`.
3. Add mocks only where needed (`Inbox` and `CircleAlert` in the lucide mock, and the colors used by StateMessage).

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/state-message.tsx`, both files around their lines, and the three tests.

### Allowed files
`apps/mobile/src/app/settings/stickers.tsx`, `apps/mobile/src/app/settings/machines.tsx`, `apps/mobile/src/components/stickers/stickers-screen.test.tsx`, `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx`, `apps/mobile/src/components/machines/machines-screen.test.tsx`, `work/T-0424-mobile-stickers-machines-empty.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot stickers-screen sticker-pack-screen machines-screen
pnpm gate
```

### Acceptance
- The three empty states are `StateMessage`s with the same texts, labels and handlers.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did**

- `apps/mobile/src/app/settings/stickers.tsx`
  - Packs empty state (old lines 333-344): replaced the `View` + `Sticker` icon + text + `Button` with `StateMessage kind="empty" icon={Sticker} title="No packs on your panel yet. Look in Discover for shared packs to add." action={{ label: 'Open Discover', accessibilityLabel: 'Open Discover', onPress: () => openTab('discover') }}`.
  - Favorites empty state (old lines 502-507): replaced the `View` + text with `StateMessage kind="empty" title="No favorites yet. Starred stickers show up here."`.
- `apps/mobile/src/app/settings/machines.tsx`
  - Machines empty state (old lines 300-316): replaced the `View` + `Server` icon + text + `Button` with `StateMessage kind="empty" icon={Server} title="No machines yet. Add one to let your AIs work on your own computers." action={{ label: 'Add machine', accessibilityLabel: 'Add a machine', onPress: openAdd }}`.
- Imports: none removed. `Sticker`/`Server` are still used as the `icon` prop; `Plus` and `ACCENT_FOREGROUND` are still used elsewhere in both files (`stickers.tsx` Plus at line 311, `machines.tsx` Plus at line 275 and `ACCENT_FOREGROUND` at lines 629/631); `ICON` is still used throughout.
- Tests: removed the one allowed assertion, `expect(html).toMatch(/<Plus[^>]*color="#0a0a0a"/)`, at `apps/mobile/src/components/machines/machines-screen.test.tsx` (old line 203). No other assertion changed. No mock additions were needed: the lucide mocks in all three test files already stub `Inbox` and `CircleAlert`, and the `@/lib/colors` mocks already provide `DANGER` and `MUTED_FOREGROUND` used by `StateMessage`. `stickers-screen.test.tsx` and `sticker-pack-screen.test.tsx` needed no edits.

**Files changed**: `apps/mobile/src/app/settings/stickers.tsx`, `apps/mobile/src/app/settings/machines.tsx`, `apps/mobile/src/components/machines/machines-screen.test.tsx`, `work/T-0424-mobile-stickers-machines-empty.md`.

**Commands and results**

- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot stickers-screen sticker-pack-screen machines-screen` → `3 passed (3)`, `34 passed (34)` (stderr only React "incorrect casing" warnings from the RN mocks).
- `pnpm gate` (first run) → `FAIL format`, `[warn] apps/mobile/src/app/settings/stickers.tsx`, scope clean.
- `pnpm exec prettier --write apps/mobile/src/app/settings/stickers.tsx` → formatted (collapsed the favorites `StateMessage` to one line).
- `pnpm gate` (final) →
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (12.0s)
  PASS  lint  (1.4s)
  PASS  typecheck  (6.1s)
  PASS  tests @zilar/mobile  (1.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Deviations / open questions**: none.

## Review (written by Claude)

**2026-10-06, lead:** approved. The pre-review was clean.
- The three empty states are StateMessages with the same texts, labels and handlers.
- The packs and machines states keep their Sticker and Server icons.
- Only the allowed Plus-colour assertion was removed.
