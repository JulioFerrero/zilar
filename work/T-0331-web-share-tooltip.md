---
id: T-0331
title: "Web: the disabled Share button on an imported sticker pack shows its reason again"
status: todo
milestone: M5
branch: task/T-0331-web-share-tooltip
model: auto
effort: low
depends_on: [T-0327]
estimate: 0.1 day
---

# T-0331: imported pack Share reason

## Spec (written by Claude, do not edit)

### Why
T-0327 moved the Stickers page Share / Make private button onto the kit `Button`. The kit adds `disabled:pointer-events-none` (`apps/web/src/components/ui/button.tsx:11`), so on an imported pack the disabled button no longer shows its hover title, "Imported packs stay private for personal use". Users see a dead Share button with no reason.

### Verified facts (do not re-derive)
- **`apps/web/src/routes/StickersPage.tsx:426-439`:**
  - the button is `<Button type="button" variant="outline" size="sm" onClick={() => void toggleVisibility(pack)} disabled={pack.importedFrom !== undefined} title={pack.importedFrom !== undefined ? 'Imported packs stay private for personal use' : undefined}>`;
  - its label is `{pack.visibility === 'server' ? 'Make private' : 'Share'}`.
- `apps/web/src/routes/StickersPage.test.tsx` has imported-pack fixtures (`importedFrom: 'telegram:FunCats'` at lines 288 and 394).

### What to build
1. When `pack.importedFrom !== undefined`, wrap the button in a `<span title="Imported packs stay private for personal use" className="inline-flex">`. The span receives the hover, because the disabled button ignores the pointer.
2. Remove the `title` prop from the button itself.
3. Give the button `aria-describedby` pointing to an sr-only span with the same text, so screen readers hear the reason too. Use `useId` or the pack id for the id.
4. **New test in `StickersPage.test.tsx`:** for an imported pack, the Share button is disabled and its accessible description is the reason (`toHaveAccessibleDescription`, or read `aria-describedby` and the target's text).

### Read first
`AGENTS.md`, `apps/web/src/routes/StickersPage.tsx:395-470`, and `apps/web/src/routes/StickersPage.test.tsx:280-300` and `:385-415`.

### Allowed files
`apps/web/src/routes/StickersPage.tsx`, `apps/web/src/routes/StickersPage.test.tsx`, `work/T-0331-web-share-tooltip.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot StickersPage
pnpm gate
```

### Acceptance
- An imported pack's disabled Share button shows the reason on hover (title on the wrapper) and announces it (aria-describedby).
- Existing tests pass, and the new test passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
