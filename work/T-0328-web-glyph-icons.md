---
id: T-0328
title: "Web: glyph characters (★, ✕) in the sticker panel, Telegram import and Connections become lucide icons"
status: todo
milestone: M5
branch: task/T-0328-web-glyph-icons
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0328: glyphs become icons (web, batch 1)

## Spec (written by Claude, do not edit)

### Why
Julio wants icons in the app, not emoji or glyph characters. A few web buttons still draw `★` or `✕` as text, which renders differently per font. PackEditor and StickersPage also have glyphs, but other running tasks edit those files; **leave them**.

### Verified facts (do not re-derive)
- **`apps/web/src/components/StickerPanel.tsx`:**
  - line 453: the Favorites tab button (`aria-label="Favorites"`) shows `★`;
  - line 527: the per-sticker favorite toggle (`aria-pressed={starred}`) shows `★`, white when starred and muted when not.
- **`apps/web/src/components/TelegramImportDialog.tsx:110`:** the Close button (`aria-label="Close"`) shows `✕`.
- **`apps/web/src/routes/ConnectionsPage.tsx:314`:** the New connection form's Close button (`aria-label="Close"`) shows `✕`. Line 3 imports from `lucide-react`.
- No web test mocks `lucide-react` for these components, and no test queries the glyphs.

### What to build
1. **StickerPanel line 453:** `<Star className="size-3.5" aria-hidden="true" />`, filled (`fill-current`) when the Favorites tab is active.
2. **StickerPanel line 527:** `<Star className={cn('size-3', starred && 'fill-current')} aria-hidden="true" />`.
3. **TelegramImportDialog line 110 and ConnectionsPage line 314:** `<X className="size-4" aria-hidden="true" />`.
4. Keep every button's classes, labels and handlers.

### Read first
`AGENTS.md`, and the four lines above with about 15 lines of context each.

### Allowed files
`apps/web/src/components/StickerPanel.tsx`, `apps/web/src/components/TelegramImportDialog.tsx`, `apps/web/src/routes/ConnectionsPage.tsx`, `work/T-0328-web-glyph-icons.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot StickerPanel TelegramImport ConnectionsPage
pnpm gate
```

### Acceptance
- `★` and `✕` no longer appear in the three files.
- Existing tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
