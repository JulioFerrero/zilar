---
id: T-0367
title: "Web kit: the pinned banner's Dismiss, next-pin counter and List buttons use the kit Button"
status: merged
milestone: M5
branch: task/T-0367-web-pinned-banner-buttons-kit
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0367: pinned banner buttons on the kit

## Spec (written by Claude, do not edit)

### Why
The pinned-message banner above a chat hand-rolls four small ghost text buttons with a copied class.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/button.tsx`:**
  - the `ghost` variant is `hover:bg-surface-raised hover:text-foreground` with the kit focus ring;
  - size `sm` is `h-7 gap-1 rounded-md px-2.5 text-[0.8rem]`;
  - `cn` merges a caller `className`.
- **The four buttons in `apps/web/src/components/PinnedBanner.tsx`** (the line is the `<button`):

| Line | Text and label | Look today | Keep |
| --- | --- | --- | --- |
| 41 | "Dismiss" (`aria-label="Dismiss pins error"`) | `shrink-0 rounded-full px-2 py-0.5 text-[12px] text-muted-foreground hover:bg-surface-raised …` | `shrink-0` |
| 104 | `` `${n} of ${pins.length}` `` (`aria-label` "Show next pinned message, …") | `… font-mono text-[11px] …` | `shrink-0 font-mono` |
| 113 | "List" (`aria-label` "Open pinned messages, …") | `… text-[13px] font-medium …` | `shrink-0` |
| 135 | "Dismiss" (another `aria-label="Dismiss …"`) | the same as line 41 | `shrink-0` |

- **Leave alone:** the main "Jump to …" button at line 86. It is a full-width text area, not a pill.
- **Tests:** `apps/web/src/components/PinnedMessages.test.tsx` covers pins and may query these by name. Keep every `aria-label` and text.

### What to build
1. Replace the four buttons with `<Button type="button" variant="ghost" size="sm" className="shrink-0 text-muted-foreground …">`. Keep:
   - every `aria-label`, `onClick` and text;
   - `font-mono` on the counter.
2. Import `Button`.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx` and `apps/web/src/components/PinnedBanner.tsx`.

### Allowed files
`apps/web/src/components/PinnedBanner.tsx`, `apps/web/src/components/PinnedMessages.test.tsx`, `work/T-0367-web-pinned-banner-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot PinnedMessages
pnpm gate
```

### Acceptance
- Only the Jump button remains a hand-rolled `<button>` in `PinnedBanner.tsx`.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)
- Replaced the four hand-rolled ghost buttons in `apps/web/src/components/PinnedBanner.tsx` (both "Dismiss pins error" buttons, the `n of N` counter, and the "List" button) with `<Button type="button" variant="ghost" size="sm" className="shrink-0 text-muted-foreground …">`, keeping every `aria-label`, `onClick` and text, plus `font-mono` on the counter. Added the `Button` import. Left the "Jump to …" button as a hand-rolled `<button>` per spec.
- Files changed: `apps/web/src/components/PinnedBanner.tsx`, `work/T-0367-web-pinned-banner-buttons-kit.md`.
- Commands:
  - `pnpm install`: pass (done in 24.2s).
  - `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot PinnedMessages`: 1 file passed, 15 tests passed.
  - `pnpm gate`: GATE PASS — install PASS, format PASS, lint PASS, typecheck PASS, tests @zilar/web PASS; scope: every changed file is inside the Allowed files; 2 changed files against main.
- Security checklist: no secrets/tokens handled; no deletes/updates, permissions, caps, routes, rate limits, or audit entries touched. N/A.

## Review (written by Claude)

Approved (lead, 2026-10-06). The two Dismiss buttons, the counter (keeps `font-mono`) and List are kit `Button` ghost `sm` with `shrink-0 text-muted-foreground`; the Jump button stays. Pre-review clean (0 findings).
