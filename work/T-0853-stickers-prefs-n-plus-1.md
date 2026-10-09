---
id: T-0853
title: "Sticker discover page and chat-prefs room check: batch the per-row queries"
status: todo
milestone: M5
branch: task/T-0853-stickers-prefs-n-plus-1
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0853: Sticker discover page and chat-prefs room check: batch the per-row queries

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding C-F8 items 4 and 5 in `docs/audit/simplify-2026-10-09/C-server.md`.
- **Sticker discover:** the discover page (about `apps/server/src/stickers/service.ts:555-566`) runs one query per pack, for pages of up to 200 packs. The `pack_id IN ${sql.in(...)}` form is already written at about :334.
- **Chat prefs:** `canSeeRoomJid` (about `apps/server/src/chat-prefs/service.ts:78`) loops `canSeeTopic` (3 queries) per topic row.

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Batch the discover page's per-pack query with the existing `IN` form.
2. Make `canSeeRoomJid` use one batched visibility lookup (look for the batch visibility helper in `apps/server/src/topics/access.ts`, about lines 219-231) instead of a per-topic loop.

Keep identical: results, ordering and visibility rules. The existing tests must pass unchanged, and add one equivalence test each.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/server/src/stickers/service.ts`, `apps/server/src/stickers/*.test.ts`, `apps/server/src/chat-prefs/service.ts`, `apps/server/src/chat-prefs/*.test.ts`, `work/T-0853-stickers-prefs-n-plus-1.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=30000 --hookTimeout=30000 src/stickers src/chat-prefs
pnpm --filter @zilar/server typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.

---

## Report (written by the worker when done)

## Review (written by Claude)
