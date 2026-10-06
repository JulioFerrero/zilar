---
id: T-0379
title: "Web kit: Explore's searching, error, empty and Show more states use StateMessage and the kit Button"
status: todo
milestone: M5
branch: task/T-0379-web-explore-states-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0379: Explore states on the kit

## Spec (written by Claude, do not edit)

### Why
The Explore page hand-rolls its loading, error and empty lines, and its Retry and Show more pills.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/state-message.tsx`:**
  - `StateMessage({ kind: 'empty' | 'loading' | 'error', title, hint?, icon?, action?, size? })`;
  - `kind="error"` renders `role="alert"`, and `loading` renders `role="status"` (line 27);
  - `action` renders a kit `Button` with `{ label, onClick }`.
- `apps/web/src/components/ui/button.tsx`: `outline` variant. `Button` is imported at `apps/web/src/components/ExplorePage.tsx:6`.
- **`apps/web/src/components/ExplorePage.tsx`:**
  - line 186-188: `{state === 'loading' && (<p className="py-6 text-center text-[14px] text-muted-foreground">Searching…</p>)}`;
  - lines 189-203: the error `<div>` with `<p role="alert" className="text-[14px] text-danger">{errorMessage}</p>` and a raw Retry `<button>` whose `onClick` runs `setState('loading'); setAttempt((value) => value + 1);`;
  - lines 205-210: the empty `<p>`, which shows "No public groups or channels yet. Be the first to make one public." when `trimmed === ''`, otherwise "Nothing public matches “${trimmed}”. Try another name or @handle.";
  - line 244: the raw Show more `<button disabled={loadingMore} onClick={() => void loadMore()}>` with `{loadingMore ? 'Loading…' : 'Show more'}`.
- **Test:** `apps/web/src/components/ExplorePage.test.tsx`:
  - line 138: `findByRole('alert')`;
  - line 140: the button "Retry";
  - line 150: the button "Show more";
  - other cases may match the empty texts.

  Keep these roles and texts.

### What to build
1. Loading → `<StateMessage kind="loading" title="Searching…" />`.
2. Error → `<StateMessage kind="error" title={errorMessage} action={{ label: 'Retry', onClick: () => { setState('loading'); setAttempt((value) => value + 1); } }} />`.
3. Empty → `<StateMessage kind="empty" title={…the same two texts…} />`.
4. Show more → `<Button type="button" variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>`.
5. Import `StateMessage` from `@/components/ui/state-message`.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/state-message.tsx`, `apps/web/src/components/ExplorePage.tsx:180-255` and `apps/web/src/components/ExplorePage.test.tsx`.

### Allowed files
`apps/web/src/components/ExplorePage.tsx`, `apps/web/src/components/ExplorePage.test.tsx`, `work/T-0379-web-explore-states-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ExplorePage
pnpm gate
```

### Acceptance
- No hand-rolled `<button` and no plain `Searching…</p>` remain in `ExplorePage.tsx`.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
