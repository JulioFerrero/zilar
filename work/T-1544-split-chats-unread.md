---
id: T-1544
title: "Split apps/server/src/chats/unread.ts (400 lines) before it grows: the two archive SQL builders (buildUnreadQuery, buildNewestQuery) and their row type move to chats/unread-queries.ts; unread.ts keeps its exports; no behaviour change"
status: merged
milestone: M5
branch: task/T-1544-split-chats-unread
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1544: Split chats/unread.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/chats/unread.ts` is exactly 400 lines, the limit (`CLAUDE.md`). **Follow `docs/audit/split-rules.md`.** It is not a `size-plan.md` entry, so this spec names the parts.

The file is in the message pipeline (unread counts), so the move must be exact.

### Facts (the lead read them on main, 2026-10-15)
- **Exports:**
  - `ChatUnread` (`:21`);
  - `UnreadScope` (`:34`);
  - `summarizeUnread` (`:249`);
  - `unreadForChats` (`:312`).
- **Internal:**
  - the constants `UNREAD_CAP`, `NEWEST_SCAN_ROWS` and `NO_MARK_WINDOW_DAYS` (`:37-43`);
  - `ArchiveUnreadRow` (`:45`);
  - `archiveIdOf` (`:59`), `labelForRow` (`:65`), `isOwnRow` (`:89`) and `senderNameForPreview` (`:102`);
  - `ChatThreshold` (`:113-131`, with the BigInt comment, T-1205);
  - `buildUnreadQuery` (`:132-190`) and `buildNewestQuery` (`:191-248`).
- **Importers:** `apps/server/src/chats/api.ts`, `apps/server/src/chats/deliveries.ts` and `apps/server/src/chats/unread.test.ts`.

### Steps
1. **New `apps/server/src/chats/unread-queries.ts`:** move `ChatThreshold` (with its comment), `buildUnreadQuery`, `buildNewestQuery`, and the constants and `ArchiveUnreadRow` they use, unchanged. Export what `unread.ts` needs from it.
2. **`unread.ts`** keeps `ChatUnread`, `UnreadScope`, `summarizeUnread`, `unreadForChats` and the row helpers, and imports the builders. If `unread-queries.ts` needs `UnreadScope`, import the type from `./unread` (type-only, so there is no runtime cycle), or move `UnreadScope` into `unread-queries.ts` and re-export it from `unread.ts`.
3. **No importer changes.** No behaviour change: the SQL text must be byte-identical.

### Tests
None new. `pnpm --filter @zilar/server exec vitest run src/chats/unread.test.ts --reporter=dot` must pass unchanged.

### Allowed files
- `apps/server/src/chats/unread.ts`
- `apps/server/src/chats/unread-queries.ts` (new)
- `work/T-1544-split-chats-unread.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/chats/unread.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **The Report gives:**
  - the `wc -l` of both files;
  - the export list of `unread.ts` before and after (identical);
  - the unread test result;
  - the gate summary.

---

## Report (written by the worker when done)

### What I did

Followed `docs/audit/split-rules.md`.

- **New `apps/server/src/chats/unread-queries.ts`** (152 lines): moved `UNREAD_CAP`, `NEWEST_SCAN_ROWS`, `NO_MARK_WINDOW_DAYS`, `ArchiveUnreadRow`, `ChatThreshold` (with its T-1205 BigInt comment), `buildUnreadQuery` and `buildNewestQuery`, unchanged apart from adding `export` to the names `unread.ts` needs.
- **`apps/server/src/chats/unread.ts`** (262 lines): keeps `ChatUnread`, `UnreadScope`, `summarizeUnread`, `unreadForChats` and the row helpers (`archiveIdOf`, `labelForRow`, `isOwnRow`, `senderNameForPreview`). It now imports the two builders, the two constants it uses (`UNREAD_CAP`, `NO_MARK_WINDOW_DAYS`), `ChatThreshold` and `ArchiveUnreadRow` from `./unread-queries`.
- `unread-queries.ts` takes `UnreadScope` as a **type-only** import from `./unread` (`import type { UnreadScope } from './unread'`), so there is no runtime cycle; `unread.ts` imports only the two functions as values.
- No importer changed: `api.ts`, `deliveries.ts` and `unread.test.ts` still import from `./unread`.
- No new tests, no test edits.

**SQL byte-identical check:** `diff` of the `buildUnreadQuery` and `buildNewestQuery` blocks between `HEAD:unread.ts` and the new file differs **only** by the added `export` keyword on those two functions (all template-literal SQL and bodies identical).

**Effect ratchet:** the new file's imports are plain (no `effect`/legacy) and it has no hard/weak signals, so it classifies `plain`; no `// effect-plain:` marker was added, and the gate `effect` step passed.

### Files changed

- `apps/server/src/chats/unread.ts` (modified)
- `apps/server/src/chats/unread-queries.ts` (new)
- `work/T-1544-split-chats-unread.md` (this report)

### Export list before → after

Barrel `unread.ts`, before (`grep -E '^export'` on `HEAD`):

```
export interface ChatUnread {
export type UnreadScope = { kind: 'dm'; peer: string } | { kind: 'room'; room: string };
export function summarizeUnread(
export async function unreadForChats(
```

Barrel `unread.ts`, after: **identical** (same four lines).

New file `unread-queries.ts` additionally exports (no existing importer of `unread.ts` is affected):
`UNREAD_CAP`, `NEWEST_SCAN_ROWS`, `NO_MARK_WINDOW_DAYS`, `ArchiveUnreadRow`, `ChatThreshold`, `buildUnreadQuery`, `buildNewestQuery`.

### Line counts

- `apps/server/src/chats/unread.ts`: `wc -l` = **262** (was 400).
- `apps/server/src/chats/unread-queries.ts`: `wc -l` = **152**.

Both under 400; no `max-lines` warning.

### Checks run

1. `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chats/unread.test.ts`
   → **Test Files 1 passed (1); Tests 6 passed (6)** (2.76s).
2. `pnpm gate` (from repo root) summary:
   ```
   gate: 3 changed file(s) against main
   PASS  install (frozen)  (1.5s)
   PASS  format  (0.8s)
   PASS  lint  (1.0s)
   PASS  typecheck  (4.1s)
   PASS  effect  (1.0s)
   PASS  tests @zilar/server  (25.2s)
   scope: every changed file is inside the Allowed files
   migration: every added migration continues from the base
   images: every workspace package an app image needs is copied into its Dockerfile
   size: every changed source file is within 400 lines
   GATE PASS
   ```

`git status --short` shows exactly the three Allowed files.

### Notes for the lead

- Spec step 2 left the choice of `UnreadScope` placement open; I kept it in `unread.ts` and used a type-only import in `unread-queries.ts` (erased under `verbatimModuleSyntax`), so there is no runtime cycle and the barrel export list is unchanged.
- No behavior change: the archive SQL strings are byte-identical (verified by `diff`, only `export` added).
- Not pushed, merged or branched.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **What the lead checked:**
  - `buildUnreadQuery` and `buildNewestQuery` in `unread-queries.ts` are byte-identical to main's (diffed function by function), so the SQL is unchanged;
  - `unread.ts` still exports `ChatUnread`, `UnreadScope`, `summarizeUnread` and `unreadForChats`;
  - the files are now 262 and 152 lines (was 400).
- **No importer changed.** The unread test passed in the worker's gate.
