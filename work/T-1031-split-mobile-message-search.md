---
id: T-1031
title: "Size split T97: apps/mobile/src/components/chat/message-search.ts (451 lines) into chat/{message-search-format,message-search-scheduler}.ts"
status: merged
milestone: M5
branch: task/T-1031-split-mobile-message-search
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1031: Split the mobile `message-search.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/chat/message-search.ts` is 451 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #93 (task T97): `components/chat/message-search-format.ts` and `chat/message-search-scheduler.ts`, under `apps/mobile/src/`. `message-search.ts` keeps the rest and re-exports every name it exports today.

Move the code unchanged, and skip the Dedup, because it crosses files to `lib/effect/timers.ts`.

The lead runs a phone smoke of the Chats tab search in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #93, and `apps/mobile/src/components/chat/message-search.ts`.

### Allowed files
`apps/mobile/src/components/chat/message-search.ts`, `apps/mobile/src/components/chat/message-search-format.ts`, `apps/mobile/src/components/chat/message-search-scheduler.ts`, `work/T-1031-split-mobile-message-search.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/mobile/src/components/chat/message-search.ts` into two new modules and left the original path as a barrel, moving code unchanged and adding no behaviour:

- `message-search-format.ts` (new) — the pure helpers: `MESSAGE_SEARCH_DEBOUNCE_MS`, `MESSAGE_SEARCH_MIN_LENGTH`, `DebouncedQuery`, `activeQuery`, `MessageSearchStatus`, `nearEnd`, `SnippetPart`, `snippetParts`, `SearchGroup`, `groupSearchByChat`, `searchResultTitle`, `MESSAGE_SEARCH_LIMIT`.
- `message-search-scheduler.ts` (new) — the clock seam and request runner: `SearchScheduler`, `SearchInput` (unexported), `settleSearch`.
- `message-search.ts` (barrel) — keeps `defaultScheduler`, `MessageSearchControllerOptions`, `MessageSearchController` and re-exports every name it exported before, at the same path, with the same names and kinds.

Imports were redistributed (format needs `type SearchItem`; scheduler needs `Effect` + `type SearchApi`/`type SearchPage`; the barrel keeps `SearchApiError`/`SearchApi` and `Effect`/`Fiber` for `defaultScheduler`). Bodies are otherwise byte-identical to the original.

The plan's **Dedup** (a shared sleep-fiber timer in `lib/effect/timers.ts`) was skipped, as the spec says, because it crosses files.

### Deviations from the plan (and why)

1. **`defaultScheduler` stays in the barrel, not in `message-search-scheduler.ts`.** Moving it out left the barrel `needs-effect`: its retained controller calls `this.frames.setTimeout(...)` (signal H3) but no longer held an `effect` value import, so the ratchet failed with `message-search.ts needs Effect (H3)`. The barrel was `effect` on `main`, so this was a regression. `split-rules.md` item 6 sanctions the `// effect-plain:` marker only for a **new** file (precedent: `work/T-0963-split-server-actions-gateway.md`), so instead the barrel keeps `defaultScheduler` and its `Effect`/`Fiber` import, and stays kind `effect` exactly as on `main`. `defaultScheduler` is used only by the barrel's controller, so this is a small, honest boundary.
2. **`settleSearch` is exported from `message-search-scheduler.ts`** (it was module-private) so the barrel's controller can call it. `SearchInput` stays unexported. These are not re-exported by the barrel, so the public surface is unchanged (same approach as `work/T-0960-split-server-agents-reply.md`).

No `// effect-plain:` marker was added anywhere: `message-search-scheduler.ts` imports `effect` as a value (kind `effect`), `message-search-format.ts` is pure (kind `plain`), and the barrel is `effect`.

### Files changed (all inside Allowed files)

- `apps/mobile/src/components/chat/message-search.ts` (modified)
- `apps/mobile/src/components/chat/message-search-format.ts` (new)
- `apps/mobile/src/components/chat/message-search-scheduler.ts` (new)
- `work/T-1031-split-mobile-message-search.md` (this file)

No importer changed. `grep` for importers finds `people-search.ts` (`type SearchScheduler`), `search-snippet.tsx` (`snippetParts`), `message-search-list.tsx` (`groupSearchByChat`, `nearEnd`, `searchResultTitle`) and `use-message-search.ts` (`MessageSearchController`, `type MessageSearchStatus`); all still resolve through the barrel.

### split-rules item 8

**`wc -l`:**

- old `apps/mobile/src/components/chat/message-search.ts`: **451** (`git show main:... | wc -l`)
- new `message-search.ts` (barrel): **342**
- new `message-search-format.ts`: **115**
- new `message-search-scheduler.ts`: **31**

Every file is ≤ 400 lines.

**Export list before and after.** `grep -E '^export'` on the old file against the barrel plus the two new files:

Old (`main`), 15 names: `MESSAGE_SEARCH_DEBOUNCE_MS` (const), `MESSAGE_SEARCH_MIN_LENGTH` (const), `DebouncedQuery` (type), `activeQuery` (fn), `MessageSearchStatus` (type), `nearEnd` (fn), `SnippetPart` (interface), `snippetParts` (fn), `SearchGroup` (interface), `groupSearchByChat` (fn), `searchResultTitle` (fn), `MESSAGE_SEARCH_LIMIT` (const), `SearchScheduler` (interface), `MessageSearchControllerOptions` (interface), `MessageSearchController` (class).

After — barrel re-exports all 15 with the same names and kinds:

```
export { MESSAGE_SEARCH_DEBOUNCE_MS, MESSAGE_SEARCH_LIMIT, MESSAGE_SEARCH_MIN_LENGTH,
         activeQuery, groupSearchByChat, nearEnd, searchResultTitle, snippetParts };
export type { DebouncedQuery, MessageSearchStatus, SearchGroup, SnippetPart, SearchScheduler };
export interface MessageSearchControllerOptions { ... }
export class MessageSearchController { ... }
```

No name added, removed or changed in kind. `defaultScheduler`, `SearchInput` and `settleSearch` are new module-level exports in `message-search-scheduler.ts`/the barrel but are **not** re-exported publicly, so the public surface is identical (the barrel's own `^export` lines are the block above).

I verified by diff that the moved bodies are byte-identical: `format.ts` body == original lines 21–133, `scheduler.ts` body == original lines 135–139 + 150–170 (`settleSearch` only gained `export`), `defaultScheduler` == original 141–148, controller + options == original 172–451.

### Commands and real results

- `pnpm install` — Done in 18.8s (1172 reused, lockfile frozen; the gate runs it again).
- `pnpm gate` (repo root) — summary lines:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (2.5s)
  PASS  format  (1.5s)
  PASS  lint  (1.0s)
  PASS  typecheck  (2.9s)
  PASS  effect  (1.3s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

`pnpm gate`'s `typecheck` step covers the task's `pnpm --filter @zilar/mobile typecheck` check. No single test files were run: the gate reported "no nearby test files" for `@zilar/mobile`, and no test imports this module (checked with grep). No new tests were written and no test was edited.

### Problems / notes

- A first gate run failed on `effect` (`message-search.ts needs Effect (H3)`); fixed by deviation 1 above.
- While producing the byte-diff evidence I accidentally wrote two stray temp files into the chat component dir (`message-search.ts.ds`, `message-search.ts.ctl`); I deleted them and re-ran the gate, which is the clean `GATE PASS` above with 4 changed files.
- No secrets, permissions or data-scoping code is involved; the change is a pure code move.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `message-search.ts` (451 lines) is now 342 lines, plus `message-search-format` (115) and `message-search-scheduler` (31).
- **The lead's line check:** the old file's non-import code lines against the new files'. The only extra is one wrapped `};`.
- **The lead's phone smoke** (mock, Chats tab): searching "plumber" shows Messages › neighbors › Diego, "Reminder: the plumber comes at 9 tomorrow."
- **Check:** the gate passed.
