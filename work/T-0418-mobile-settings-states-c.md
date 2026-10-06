---
id: T-0418
title: "Mobile kit: Profile settings, Stickers Discover, the sticker pack screen and the Add machine dialog states use StateMessage"
status: todo
milestone: M5
branch: task/T-0418-mobile-settings-states-c
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0418: more settings states on StateMessage (mobile)

## Spec (written by Claude, do not edit)

### Why
This is batch 25 of `docs/audit/ui-kit-leftovers.md`. It finishes the settings screens after T-0398, T-0399 and T-0405.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ui/state-message.tsx`:**
  - `StateMessage({ kind, title, hint?, icon?, action?: { label, onPress, accessibilityLabel? }, size?: 'block' | 'inline' })`;
  - block `loading` is a labelled spinner plus the title; block `error` is the alert role, a red icon, the title and an optional accent `sm` Button action;
  - `inline` is a small spinner plus the title, with no action.
- **The places:**

| File | Lines | Today | Becomes |
| --- | --- | --- | --- |
| `apps/mobile/src/app/settings/profile.tsx` | 309-314 | loading ("Loading…") | `StateMessage kind="loading" title="Loading…"` |
| `apps/mobile/src/app/settings/profile.tsx` | 316-325 | error "Could not load your profile." with an outline Retry (`accessibilityLabel="Retry"`, `onPress={reload}`) | `StateMessage kind="error"` with `action={{ label: 'Retry', onPress: reload }}` |
| `apps/mobile/src/app/settings/stickers.tsx` | 443-447 | Discover searching ("Searching…") | `StateMessage kind="loading" title="Searching…"` |
| `apps/mobile/src/app/settings/stickers.tsx` | 448-462 | Discover error `{discoverError === '' ? DISCOVER_ERROR : discoverError}` with an outline Retry (`accessibilityLabel="Retry loading shared packs"`, `onPress={() => loadDiscover(query)}`) | `StateMessage kind="error"` with the same title expression and `action={{ label: 'Retry', accessibilityLabel: 'Retry loading shared packs', onPress: () => loadDiscover(query) }}` |
| `apps/mobile/src/app/settings/sticker-pack.tsx` | 460-465 | loading ("Loading pack…") | `StateMessage kind="loading" title="Loading pack…"` |
| `apps/mobile/src/app/settings/sticker-pack.tsx` | 467-481 | load-error `{LOAD_ERROR}` with an outline Retry ("Retry loading pack", `onPress={load}`) | `StateMessage kind="error"` with `action={{ label: 'Retry', accessibilityLabel: 'Retry loading pack', onPress: load }}` |
| `apps/mobile/src/app/settings/sticker-pack.tsx` | 655-662 | the preparing row (small spinner plus "Preparing 1 image…" or "Preparing N images…") | `StateMessage kind="loading" size="inline" title={<same expression>}` |
| `apps/mobile/src/app/settings/machines.tsx` | 575-580 | Add machine dialog loading ("Creating code…") | `StateMessage kind="loading" title="Creating code…"` (the dialog's error part at 582+ stays as it is) |

- **Tests:**
  - `apps/mobile/src/components/stickers/stickers-screen.test.tsx`;
  - `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx`;
  - `apps/mobile/src/components/machines/machines-screen.test.tsx`;
  - no test imports `settings/profile.tsx`.

  Keep every text and label. Add mocks only if needed (as T-0399 did: `CircleAlert` and `Inbox` in the lucide mock, `DANGER` and `MUTED_FOREGROUND` in the colors mock).

### What to build
1. Apply the table.
2. Keep the conditions.
3. Drop imports (`ActivityIndicator`, `RefreshCw`, `ACCENT`, `ICON`, `scheme`) only when they become unused. Lint will flag them.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/state-message.tsx`, each file around its lines, and the three tests.

### Allowed files
`apps/mobile/src/app/settings/profile.tsx`, `apps/mobile/src/app/settings/stickers.tsx`, `apps/mobile/src/app/settings/sticker-pack.tsx`, `apps/mobile/src/app/settings/machines.tsx`, `apps/mobile/src/components/stickers/stickers-screen.test.tsx`, `apps/mobile/src/components/stickers/sticker-pack-screen.test.tsx`, `apps/mobile/src/components/machines/machines-screen.test.tsx`, `work/T-0418-mobile-settings-states-c.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot stickers-screen sticker-pack-screen machines-screen
pnpm gate
```

### Acceptance
- The eight places are `StateMessage`s with the same texts, labels and handlers.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
