---
id: T-2053
title: "Share W3-a: the pure message-search helpers (activeQuery, snippetParts, groupSearchByChat, searchResultTitle, MESSAGE_SEARCH_LIMIT) move from the phone's message-search-format.ts into chat-core search.ts; web's snippet, grouping, title and limit use them instead of their copies — no behaviour change"
status: merged
milestone: M5
branch: task/T-2053-shared-search-helpers
model: deepseek/deepseek-flash
effort: default
estimate: 30 min
---

# T-2053: Shared message-search helpers (share plan W3-a, step 1)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: share functions between web and phone. `docs/audit/share-plan.md` §2.6 found the snippet-highlight split, the group-by-chat step, the `Group › Topic` title, the active-query rule and the page size of 20 written twice. This is step 1 only, the pure helpers. Web paging (step 2) is not part of this task.

### Facts (read by the lead on 2026-10-18 at `13819b0fd`)
- **Phone.** `apps/mobile/src/components/chat/message-search-format.ts` (112 lines) holds the pure helpers:
  - `activeQuery` (`:10-13`);
  - `SnippetPart` and `snippetParts` (`:44-70`);
  - `SearchGroup` and `groupSearchByChat(items, titles: Map)` (`:72-100`);
  - `searchResultTitle` (`:107-109`);
  - `MESSAGE_SEARCH_LIMIT = 20` (`:112`);
  - plus phone-only `DebouncedQuery`, `MessageSearchStatus` and `nearEnd`, which stay.

  `apps/mobile/src/components/chat/message-search.ts:9-33` re-exports them for `message-search-list.tsx` and `search-snippet.tsx`.
- **Web copies.**
  - `apps/web/src/components/MessageSearchResult.tsx:17-35`: the same snippet split, inline in `SearchSnippet`;
  - `:91`: the inline `` `${chatTitle} › ${topicLabel}` ``;
  - `apps/web/src/components/MessageSearchResults.tsx:285-309`: `groupByChat(items, chats)`, the same as the phone's but taking chat rows (used at `:76` and `:235`);
  - `apps/web/src/lib/useMessageSearch.ts:66-67`: the inline active query, and `:40` the inline `limit: 20`.
- **Chat-core.** `packages/chat-core/src/search.ts` (27 lines) already holds `MESSAGE_SEARCH_MIN_LENGTH`. It's exported through the chat-core barrel, so there's no barrel edit.

### Steps
1. **Chat-core.** Move `activeQuery`, `SnippetPart`, `snippetParts`, `SearchGroup`, `groupSearchByChat` and `searchResultTitle`, plus `MESSAGE_SEARCH_LIMIT`, into `packages/chat-core/src/search.ts`.
   - Make the grouping generic: `groupSearchByChat<T extends { chatJid: string }>(items: readonly T[], titles: ReadonlyMap<string, string>)`, returning `{ chatJid; title; items: T[] }[]`.
2. **Phone.** `message-search-format.ts` keeps only its phone-only parts and re-exports the moved names from `@zilar/chat-core`, so importers don't change.
3. **Web.**
   - `SearchSnippet` uses `snippetParts`.
   - The title uses `searchResultTitle`.
   - `MessageSearchResults.tsx` deletes `groupByChat` and calls `groupSearchByChat(items, new Map(chats.map((c) => [c.id, c.title])))`. Keep the `SearchGroup` type it needs.
   - `useMessageSearch.ts` uses `activeQuery` and `MESSAGE_SEARCH_LIMIT`.
4. **No tests** (search UI). Report the line counts; product lines go down. Each file stays at or under 400 lines.

### Allowed files
- `packages/chat-core/src/search.ts`
- `apps/mobile/src/components/chat/message-search-format.ts`
- `apps/web/src/components/MessageSearchResult.tsx`
- `apps/web/src/components/MessageSearchResults.tsx`
- `apps/web/src/lib/useMessageSearch.ts`
- `work/T-2053-shared-search-helpers.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and product lines go down.
- **Lead check, web mock:** searching "mar" shows the Messages section with highlights and grouping, unchanged.

---

## Report (written by the worker when done)

### What I did

- `packages/chat-core/src/search.ts`: added `MESSAGE_SEARCH_LIMIT`, `activeQuery`, `SnippetPart`, `snippetParts`, generic `SearchGroup<T>` and `groupSearchByChat<T extends { chatJid: string }>(items: readonly T[], titles: ReadonlyMap<string, string>)`, and `searchResultTitle`, moved verbatim from the phone (grouping made generic).
- `apps/mobile/src/components/chat/message-search-format.ts`: now keeps only `DebouncedQuery`, `MessageSearchStatus` and `nearEnd`, and re-exports the moved names from `@zilar/chat-core`, so `message-search.ts` and its importers are unchanged. 112 → 38 lines.
- `apps/web/src/components/MessageSearchResult.tsx`: `SearchSnippet` calls `snippetParts`; the breadcrumb calls `searchResultTitle`. 106 → 88 lines.
- `apps/web/src/components/MessageSearchResults.tsx`: deleted the local `groupByChat` (and its `ReturnType` alias), calls `groupSearchByChat(items, new Map(chats.map(...)))`, and keeps `SearchGroup<SearchItem>` from chat-core. 309 → 282 lines.
- `apps/web/src/lib/useMessageSearch.ts`: uses `activeQuery` and `MESSAGE_SEARCH_LIMIT` instead of the inline rule and `limit: 20`. 97 → 97 lines.
- Total product lines: 651 → 620 (net −31). Every file is within 400 lines.

### Checks run

`pnpm install` (frozen lockfile, 23.7s): done.

`pnpm gate` from the repo root:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (0.7s)
PASS  lint  (1.5s)
PASS  typecheck  (8.2s)
PASS  effect  (2.4s)
PASS  build @zilar/server  (0.6s)
PASS  tests @zilar/chat-core  (3.1s)
PASS  tests @zilar/mobile  (1.7s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test runs: the spec says no tests for this search UI change, and the gate ran the nearest chat-core and mobile suites.

### Notes for the lead

- Behaviour should be identical: the moved function bodies are unchanged; only `groupSearchByChat` became generic (`readonly T[]` / `ReadonlyMap`) and web's chat-row map is built at the call site.
- Web `groupByChat` was exported but had no importer outside its own file (checked with grep), so deleting it is safe.
- Not done by me: the lead's web mock check (searching "mar" shows unchanged highlights and grouping).


## Review (written by Claude)

Approved; the pre-review was clean.
- **What changed.** The pure search helpers live in chat-core `search.ts`. The phone re-exports them, and web's snippet, grouping, title, active query and limit use them.
- **Size.** −35 product lines.
- **Lead Playwright check** (web mock, :5194, "mar"):
  - People, Chats and Messages show as before;
  - the "mar" highlight is in the snippet;
  - no console errors.
- **Separate fix.** Raw Markdown in snippets is a server-side task, T-2055.
