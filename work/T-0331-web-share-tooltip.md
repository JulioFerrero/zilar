---
id: T-0331
title: "Web: the disabled Share button on an imported sticker pack shows its reason again"
status: merged
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

### What I did
- In `apps/web/src/routes/StickersPage.tsx` (My packs row): the Share / Make private
  button no longer carries `title`. For imported packs (`importedFrom !== undefined`)
  it is now wrapped in `<span title="Imported packs stay private for personal use" className="inline-flex">`
  plus an sr-only span with the same text; the button gets `aria-describedby` pointing
  at that sr-only span's id (`share-reason-<pack.id>`, derived from the pack id since
  `useId` can't be used inside a `.map` callback). Non-imported packs render the plain
  button with no `aria-describedby`.
- In `apps/web/src/routes/StickersPage.test.tsx`: extended the existing
  'marks imported packs and locks them to private' test — the disabled Share button
  now asserts `title === ''`, its parent is a SPAN whose `title` is the reason, and
  the `aria-describedby` target's text is the reason. Deviation from spec: used
  `aria-describedby` + target text instead of `toHaveAccessibleDescription` because the
  web package has no jest-dom matchers (`Invalid Chai property`); the spec allowed this
  fallback.

### Files changed
- `apps/web/src/routes/StickersPage.tsx`
- `apps/web/src/routes/StickersPage.test.tsx`

### Checks (real results)
- `pnpm install`: exit 0 (Done in 11.8s).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot StickersPage`: first run 11 passed,
  1 failed (my new assertion, `Invalid Chai property: toHaveAccessibleDescription` — jest-dom
  matchers not installed); after switching to the `aria-describedby` fallback: 1 file passed,
  12 tests passed.
- `pnpm gate` (from repo root): exit 0. Summary lines:
  - `gate: 3 changed file(s) against main`
  - `PASS  install (frozen)  (1.1s)`
  - `PASS  format  (12.3s)`
  - `PASS  lint  (0.8s)`
  - `PASS  typecheck  (7.3s)`
  - `PASS  tests @zilar/web  (17.0s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Security checklist
- No secrets, tokens, or URLs touched; no deletes/updates, permissions, caps, routes,
  or audit entries involved. N/A.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**Approved** (pre-review clean, 2 nits accepted: the test extends the existing imported-pack test rather than adding a new one, and the reason string appears twice in the markup). On an imported pack, the disabled Share button sits in a span that carries the hover title, and it points with `aria-describedby` to an sr-only copy of the reason. Non-imported packs render the plain button.
