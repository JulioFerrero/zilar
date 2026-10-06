---
id: T-0325
title: "Web kit migration: Stickers page states on StateMessage, raw pill buttons on Button"
status: todo
milestone: M5
branch: task/T-0325-web-stickers-kit
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0325: Stickers page on the kit

## Spec (written by Claude, do not edit)

### Why
T-0322 moved the AIs, Connections and Machines pages to `StateMessage`. The Stickers page still hand-rolls its page-level loading and error states, and it has two hand-rolled pill buttons right next to kit `Button`s.

### Verified facts (do not re-derive)
- **`StateMessage`** (`apps/web/src/components/ui/state-message.tsx`):
  - props: `kind: 'empty' | 'loading' | 'error'`, `title`, `hint?`, `icon?` and `action?: { label, onClick }`;
  - error renders `role="alert"`.
  - See `apps/web/src/routes/AisPage.tsx` for the T-0322 usage.
- **`Button`** (`apps/web/src/components/ui/button.tsx:14-32`): variants `default`, `outline`, `secondary`, `ghost`, `destructive` and `link`; sizes `default`, `sm`, `lg`, `icon`, `icon-sm` and `icon-lg`.
- **`apps/web/src/routes/StickersPage.tsx`:**
  - line 330: loading, `<p>Loading…</p>`;
  - lines 332-341: error, `<p role="alert">{error}</p>` plus a Retry `Button` that calls `void load()`;
  - lines 355-361: a raw `<button>` "Import from Telegram" (`rounded-full border border-border-strong bg-surface … hover:bg-surface-raised`), next to `<Button size="default">Create pack</Button>`;
  - lines 556-562: a raw `<button>` "Remove" (`shrink-0 rounded-full border border-border-strong bg-surface-raised …`), the alternative to `<Button size="sm" className="shrink-0">Add</Button>`.
- **`apps/web/src/routes/StickersPage.test.tsx`** finds the alert (lines 137 and 274), the Retry button (line 138) and the "Import from Telegram" button by role and name. These tests must pass unchanged.
- **Out of scope:** the small in-section texts (Loading…, No packs yet, No shared packs found, No favorites yet). They are inline hints, not page states.

### What to build
1. Loading becomes `<StateMessage kind="loading" title="Loading…" />`.
2. Error becomes `<StateMessage kind="error" title={error} action={{ label: 'Retry', onClick: () => void load() }} />`.
3. "Import from Telegram" becomes `<Button type="button" variant="outline" size="default" onClick={…}>`.
4. "Remove" becomes `<Button type="button" variant="outline" size="sm" className="shrink-0" onClick={…}>`.
5. Handlers and texts stay the same.

### Read first
`AGENTS.md`, `apps/web/src/routes/StickersPage.tsx:320-370` and `:540-570`, `apps/web/src/routes/AisPage.tsx` (StateMessage use), and `apps/web/src/routes/StickersPage.test.tsx`.

### Allowed files
`apps/web/src/routes/StickersPage.tsx`, `work/T-0325-web-stickers-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot StickersPage
pnpm gate
```

### Acceptance
- No raw `<button` is left in `StickersPage.tsx` for these two actions, and the page states use `StateMessage`.
- `StickersPage.test.tsx` passes unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
