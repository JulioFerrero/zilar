---
id: T-0424
title: "Mobile kit: the Stickers packs and favorites empty states and the Machines empty state use StateMessage"
status: todo
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

## Review (written by Claude)
