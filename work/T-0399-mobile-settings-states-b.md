---
id: T-0399
title: "Mobile kit: the Integrations, Machines and Stickers settings screens' loading and error states use StateMessage"
status: todo
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
`apps/mobile/src/app/settings/integrations.tsx`, `apps/mobile/src/app/settings/machines.tsx`, `apps/mobile/src/app/settings/stickers.tsx`, `apps/mobile/src/components/integrations/integrations-screen.test.tsx`, `apps/mobile/src/components/machines/machines-screen.test.tsx`, `apps/mobile/src/components/stickers/stickers-screen.test.tsx`, `work/T-0399-mobile-settings-states-b.md`.

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

## Review (written by Claude)
