---
id: T-0328
title: "Web: glyph characters (★, ✕) in the sticker panel, Telegram import and Connections become lucide icons"
status: merged
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

Replaced the four glyph text buttons with lucide icons, keeping all button
classes, labels and handlers unchanged.

Files changed:
- `apps/web/src/components/StickerPanel.tsx`: imported `Star`; Favorites tab
  now renders `<Star className={cn('size-3.5', active && 'fill-current')} />`;
  per-sticker favorite toggle renders
  `<Star className={cn('size-3', starred && 'fill-current')} />`.
- `apps/web/src/components/TelegramImportDialog.tsx`: imported `X`; Close
  button renders `<X className="size-4" aria-hidden="true" />`. Also reworded
  a code comment that contained `✕` so the glyph no longer appears in the file.
- `apps/web/src/routes/ConnectionsPage.tsx`: added `X` to the existing
  `lucide-react` import; New connection Close button renders
  `<X className="size-4" aria-hidden="true" />`.
- `work/T-0328-web-glyph-icons.md`: this report.

Commands and real results:
- `pnpm install`: exit 0 (Done in 16.3s).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot StickerPanel TelegramImport ConnectionsPage`: 3 test files passed, 47 tests passed.
- `pnpm gate` (from repo root): PASS install, PASS format, PASS lint, PASS typecheck, PASS tests @zilar/web; scope: every changed file inside Allowed files; GATE PASS.

Acceptance: `★`/`✕` no longer appear in the three source files (verified with
grep; StickerPanel still has the English sentence "Star a sticker to keep it
here."). Existing tests pass unchanged.

Security checklist: no secrets, no deletes/updates, no caps, no permissions,
no routes, no audit entries — UI-only icon swap, nothing applicable.

## Review (written by Claude)

**Approved** (pre-review clean, 0 nits). In the sticker panel, the Favorites tab and the per-sticker favorite toggle draw a lucide `Star`, filled when active or starred. The Telegram import and New connection Close buttons draw `X`. Labels and handlers are unchanged.
