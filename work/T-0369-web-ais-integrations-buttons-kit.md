---
id: T-0369
title: "Web kit: the AIs page row buttons and the Integrations page Remove buttons use the kit Button"
status: merged
milestone: M5
branch: task/T-0369-web-ais-integrations-buttons-kit
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0369: AIs and Integrations page buttons on the kit

## Spec (written by Claude, do not edit)

### Why
The AIs page rows hand-roll their confirm pair and three icon buttons. The Integrations page puts a hand-rolled outline "Remove" next to a kit "Save".

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/button.tsx`:**
  - variants: `default`, `outline` (`border-border-strong bg-surface … hover:bg-surface-raised`), `ghost`, `destructive` (tinted red) and `link`;
  - sizes: `default` (h-8), `sm` (h-7), `lg`, `icon` (size-8), `icon-sm` and `icon-lg`;
  - `cn` merges a caller `className`.
- `apps/web/src/routes/AisPage.tsx` does not import `Button`. `apps/web/src/routes/IntegrationsPage.tsx:5` does.
- **The buttons to migrate** (the line is the `<button`):

| File | Line | Content | Kit |
| --- | --- | --- | --- |
| `apps/web/src/routes/AisPage.tsx` | 226 | "Remove" confirm (solid `bg-danger … text-white`, `disabled={deleting}`, `onConfirmDelete`) | `variant="destructive" size="sm"` |
| same | 234 | "Cancel" (`onCancelDelete`, `disabled={deleting}`) | `variant="ghost" size="sm"` |
| same | 245 | `MessageSquare` icon, `aria-label`/`title` "Open chat with …" | `variant="ghost" size="icon"`, `className="text-muted-foreground"` |
| same | 254 | `Pencil` icon, "Edit …" | `variant="ghost" size="icon"`, `className="text-muted-foreground"` |
| same | 263 | `Trash2` icon, "Delete …" (hover `bg-danger/10 text-danger`) | `variant="ghost" size="icon"`, `className="text-muted-foreground hover:bg-danger/10 hover:text-danger"` |
| `apps/web/src/routes/IntegrationsPage.tsx` | 433 | "Remove" (voice transcription, `disabled={busy}`), next to `<Button size="default">` Save | `variant="outline"`, default size |
| same | 563 | "Remove" (Telegram import), same pattern | `variant="outline"`, default size |

- **Leave alone:** the three show/hide key toggles in `IntegrationsPage.tsx` (lines 250, 407 and 541). They sit absolutely inside an input.
- **Tests:** `apps/web/src/components/ais/AisPage.test.tsx` (it imports `@/routes/AisPage`) and `apps/web/src/routes/IntegrationsPage.test.tsx`. They find buttons by role and name. Keep every text, `aria-label`, `title`, `disabled` and handler.

### What to build
1. Replace the seven buttons with `<Button type="button" …>`, using the table. Keep icons (`className="size-4" aria-hidden="true"`), texts, labels and handlers.
2. Import `Button` from `@/components/ui/button` in `AisPage.tsx`.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx`, `apps/web/src/routes/AisPage.tsx:215-275` and `apps/web/src/routes/IntegrationsPage.tsx:425-445` and `:555-575`.

### Allowed files
`apps/web/src/routes/AisPage.tsx`, `apps/web/src/routes/IntegrationsPage.tsx`, `apps/web/src/components/ais/AisPage.test.tsx`, `apps/web/src/routes/IntegrationsPage.test.tsx`, `work/T-0369-web-ais-integrations-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot AisPage IntegrationsPage
pnpm gate
```

### Acceptance
- `AisPage.tsx` has no hand-rolled `<button`.
- `IntegrationsPage.tsx` has only the three key toggles.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Migrated all seven hand-rolled buttons to the kit `Button`.

What I did:
- `apps/web/src/routes/AisPage.tsx`: replaced the Remove/Cancel confirm pair with `<Button variant="destructive" size="sm">` / `<Button variant="ghost" size="sm">`, and the three row icon buttons (MessageSquare, Pencil, Trash2) with `<Button variant="ghost" size="icon">` keeping `text-muted-foreground` (plus `hover:bg-danger/10 hover:text-danger` on delete). Kept all texts, aria-labels, titles, `disabled` and handlers. Changed the import from `{ Button, FieldError } from '@/components/ais/AiPageShell'` to `FieldError` from there plus `Button` from `@/components/ui/button` (the AiPageShell `Button` is a re-export of the same kit button, but the spec asks for the direct import). The pre-existing "Create AI" `<Button size="lg">` now also resolves to the kit button directly; behavior unchanged.
- `apps/web/src/routes/IntegrationsPage.tsx`: replaced the two hand-rolled "Remove" buttons (voice transcription, Telegram import) with `<Button type="button" variant="outline" ...>` next to the existing Save buttons. Left the three show/hide key toggles (lines ~250, ~407, ~541) untouched.
- No test changes needed: existing tests find buttons by role/name and all texts/labels/handlers are preserved.

Files changed:
- `apps/web/src/routes/AisPage.tsx`
- `apps/web/src/routes/IntegrationsPage.tsx`
- `work/T-0369-web-ais-integrations-buttons-kit.md` (this report + status)

Commands and real results:
- `pnpm install`: exit 0.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot AisPage IntegrationsPage`: 2 files, 20 tests passed.
- `pnpm gate` (first run): GATE FAIL on format only (`IntegrationsPage.tsx` needed Prettier collapsing the new `<Button>` props to one line); fixed with `pnpm exec prettier --write` on my two files (AisPage.tsx unchanged).
- `pnpm gate` (final): PASS install, PASS format, PASS lint, PASS typecheck, PASS tests @zilar/web; "scope: every changed file is inside the Allowed files"; GATE PASS.

Acceptance check: `AisPage.tsx` has zero `<button`; `IntegrationsPage.tsx` has exactly the three key-toggle `<button` elements.

Deviations/problems: one cosmetic note — the kit `destructive` variant is a tinted red (`bg-danger/10 text-danger`) rather than the old solid `bg-danger text-white` pill; that is the intended kit migration per the spec table. No open questions.

Security checklist: no secrets/tokens touched; no deletes/updates, permissions, caps, routes, or audit entries involved — not applicable.

## Review (written by Claude)

Approved (lead, 2026-10-06). The AIs row confirm pair and three icon buttons, and both Integrations Remove buttons, are kit `Button` as specified. The spec missed that AisPage already used the kit Button via the AiPageShell re-export; the worker now imports it directly, no behaviour change. Pre-review clean (0 findings).
