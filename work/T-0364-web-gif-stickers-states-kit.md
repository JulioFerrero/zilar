---
id: T-0364
title: "Web kit: GIF panel and Stickers page loading/error states on StateMessage; SearchField shares the TextInput field class"
status: merged
milestone: M5
branch: task/T-0364-web-gif-stickers-states-kit
model: auto
effort: low
depends_on: [T-0357, T-0358]
estimate: 0.2 day
---

# T-0364: GIF and Stickers states on the kit, shared field class

## Spec (written by Claude, do not edit)

### Why
This task finishes two follow-ups from this morning:
- T-0358 left the two Stickers page "Loading…" lines, because T-0357 was editing that file. The GIF panel also hand-rolls its loading and error states.
- The T-0357 pre-review noted that `SearchField` copies the `TextInput` field class, so the two can drift apart.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/state-message.tsx`:**
  - `StateMessage({ kind, title, hint?, icon?, action?, size? })`;
  - `size="inline"` is a small left-aligned row (T-0358);
  - `action` renders a kit `Button` with `{ label, onClick }`.
- **`apps/web/src/routes/StickersPage.tsx:549` and `:606`:** `<p className="text-[14px] text-muted-foreground">Loading…</p>`.
- **`apps/web/src/components/GifPanel.tsx`:**
  - lines 291-294: loading `<div className="flex h-[180px] items-center justify-center text-[13px] text-muted-foreground">Loading GIFs…</div>`;
  - lines 295-302: the error block, with `<p>{error}</p>` and a raw retry `<button onClick={() => void load(query, undefined, false)} className="rounded-[8px] bg-surface-raised …">`;
  - line 350: `{loadingMore && <span>Loading more…</span>}` inside the attribution footer. Leave that one.
- **The field class:**
  - `apps/web/src/components/ui/text-input.tsx:51` declares `const FIELD_INPUT = 'well-surface w-full rounded-lg px-3 py-2 text-sm …'` (not exported);
  - `apps/web/src/components/ui/search-field.tsx` repeats the same string, plus `pl-9`.
- **Tests:** `apps/web/src/components/GifPanel.test.tsx`, `apps/web/src/components/StickerPanel.test.tsx` and `apps/web/src/routes/StickersPage.test.tsx` may query "Loading…", "Loading GIFs…", the error text or the retry button by name. Keep the same visible texts and the retry button's accessible name.

### What to build
1. Replace the two StickersPage lines with `<StateMessage kind="loading" size="inline" title="Loading…" />`.
2. **GifPanel:**
   - Loading becomes `<StateMessage kind="loading" title="Loading GIFs…" />`, inside the existing `h-[180px]` box if the height must stay.
   - The error becomes `<StateMessage kind="error" title={error} action={{ label: <the current retry button text>, onClick: () => void load(query, undefined, false) }} />`.
3. Export `FIELD_INPUT` from `text-input.tsx`, and use it in `search-field.tsx` together with `pl-9`. There is no visual change.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/state-message.tsx`, `apps/web/src/components/ui/text-input.tsx`, `apps/web/src/components/ui/search-field.tsx`, `apps/web/src/components/GifPanel.tsx:270-310`, `apps/web/src/routes/StickersPage.tsx:540-610` and the three tests.

### Allowed files
`apps/web/src/routes/StickersPage.tsx`, `apps/web/src/components/GifPanel.tsx`, `apps/web/src/components/ui/text-input.tsx`, `apps/web/src/components/ui/search-field.tsx`, `apps/web/src/components/GifPanel.test.tsx`, `apps/web/src/components/StickerPanel.test.tsx`, `apps/web/src/routes/StickersPage.test.tsx`, `work/T-0364-web-gif-stickers-states-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot GifPanel StickerPanel StickersPage kit
pnpm gate
```

### Acceptance
- No plain `Loading…</p>` remains in `StickersPage.tsx`.
- GifPanel loading and error use `StateMessage`.
- `search-field.tsx` imports `FIELD_INPUT`.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

- Replaced both `Loading…` `<p>` lines in `StickersPage.tsx` (discover, favorites) with `<StateMessage kind="loading" size="inline" title="Loading…" />` (`StateMessage` was already imported).
- `GifPanel.tsx`: loading now renders `<StateMessage kind="loading" title="Loading GIFs…" />` inside the existing `h-[180px]` centering box; error now renders `<StateMessage kind="error" title={error} action={{ label: 'Retry', onClick: () => void load(query, undefined, false) }} />` inside the same fixed-height box. Left the `loadingMore` footer span alone. Visible texts ("Loading GIFs…", error text, "Retry" button name) unchanged.
- Exported `FIELD_INPUT` from `text-input.tsx`; `search-field.tsx` now imports it and uses `cn(FIELD_INPUT, 'pl-9')`. No visual change.
- Files changed: `apps/web/src/routes/StickersPage.tsx`, `apps/web/src/components/GifPanel.tsx`, `apps/web/src/components/ui/text-input.tsx`, `apps/web/src/components/ui/search-field.tsx`, plus this task file.
- Commands:
  - `pnpm install`: ok (14.2s).
  - `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot GifPanel StickerPanel StickersPage kit`: 4 files, 99 passed.
  - `pnpm gate`: GATE PASS — install ok, format ok (after collapsing the `search-field.tsx` input to one line via `prettier --write` on that file only), lint ok, typecheck ok, tests @zilar/web ok, scope: every changed file is inside the Allowed files.
- Security checklist: no secrets/tokens touched; no deletes/updates; no caps/uniqueness logic; no permission changes; no new routes; no audit entries. Nothing renders raw server text beyond the existing error-title behavior the spec required (`title={error}` per spec).
- No deviations from the spec; no open questions.

## Review (written by Claude)

Approved (lead, 2026-10-06). StickersPage's two loading lines are inline `StateMessage`; GifPanel loading and error are `StateMessage` inside the 180px box, and Retry is the kit action with the same call; `FIELD_INPUT` is exported and reused by `SearchField` (identical string). Pre-review clean (0 findings).
