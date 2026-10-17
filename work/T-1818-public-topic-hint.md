---
id: T-1818
title: "New topic forms (web + phone): the public hint says anyone in the group can find and join it (not that everyone is in it), matching new public topics starting empty"
status: merged
milestone: M5
branch: task/T-1818-public-topic-hint
model: auto
effort: default
depends_on: [T-1802]
estimate: 10 min
---

# T-1818: The public topic hint

## Spec (written by Claude, do not edit)

### Why
Since T-1802, a new public topic starts with only its creator; others join from Other topics. Both new-topic forms still say "Everyone in the group can read and write here."

### Facts (read by the lead on 2026-10-17)
- **Web:** `apps/web/src/components/NewTopicDialog.tsx:241-243`, `visibility === 'public' ? 'Everyone in the group can read and write here.' : '…'`.
- **Phone:** `apps/mobile/src/components/chat/new-topic-sheet.tsx:197-199`, the same text.

### Steps
1. In both files, replace the public text with exactly: `Anyone in the group can find it and join.` Leave the private text unchanged.
2. **No tests** (UI).

### Allowed files
- `apps/web/src/components/NewTopicDialog.tsx`
- `apps/mobile/src/components/chat/new-topic-sheet.tsx`
- `work/T-1818-public-topic-hint.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- Both forms show the new public hint.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

Changed the public-visibility hint in both new-topic forms from
`Everyone in the group can read and write here.` to
`Anyone in the group can find it and join.`

- `apps/web/src/components/NewTopicDialog.tsx:242`
- `apps/mobile/src/components/chat/new-topic-sheet.tsx:198`

The private-visibility text is unchanged in both files. No tests were added, as the spec says (UI change).

### Checks run

`pnpm install` — done, completed in 26.5s with pnpm v10.32.1.

`pnpm gate` (from the repo root) — GATE PASS. Summary lines:

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (0.7s)
PASS  lint  (1.4s)
PASS  typecheck  (6.1s)
PASS  effect  (1.1s)
PASS  tests @zilar/mobile  (1.8s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test files were run separately: the change is UI text only and the spec asks for no tests.

### Notes for the lead

- Verified with a grep over `apps/` that the old sentence no longer appears anywhere; only the two new hints match.
- No deviations from the spec. Nothing blocked.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `bc50d0df9`.
- **Web and phone** both say "Anyone in the group can find it and join." for a public topic; the private text is unchanged.
