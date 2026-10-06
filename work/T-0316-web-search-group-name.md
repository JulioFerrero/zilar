---
id: T-0316
title: "Web fix: the chat list search also matches a group by its own name"
status: merged
milestone: M5
branch: task/T-0316-web-search-group-name
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0316: web search finds groups by name

## Spec (written by Claude, do not edit)

### Why
Searching "dev" in the chat list does not find the "Dev team" group. Each topic row carries the group's name in `chat.groupTitle`, but the filters compare only `chat.title`, which for a topic is the topic name (e.g. "General").

The lead found this in the mobile code after emulator QA run 17; T-0314 fixed mobile. Web has the same filter in two places.

### Verified facts (do not re-derive)
- **`apps/web/src/store/store.ts`:**
  - lines 1450-1464, `visibleChats`: `return query.length === 0 || chat.title.toLowerCase().includes(query);`
  - lines 1480-1482: `groupTitleOf(chat)` returns `chat.groupTitle ?? chat.title`;
  - lines 1494-1545, `groupChats`:
    - topics are collected per `groupId`;
    - then `matching = query.length === 0 ? topics : topics.filter((topic) => topic.title.toLowerCase().includes(query))`;
    - a group with no `matching` topic is skipped.
- **Tests:** `apps/web/src/store/folders.test.ts` imports `createChatStore` and `visibleChats` from `./store`, with `ChatSummary` fixtures (lines 1-80); use it as the model.

### What to build
1. **In `groupChats`:** when the group's title (`groupTitleOf(topics[0])`) contains the query (case-insensitive, trimmed as now), every topic of that group matches. Otherwise the topic-title filter stays as it is.
2. **In `visibleChats`:** a chat also matches when `chat.groupTitle` contains the query.
3. **New test file `apps/web/src/store/search.test.ts`,** in the style of `folders.test.ts`. A group "Dev team" with topics "General" and "Bugs", plus a DM "Ana":
   - `dev` → `groupChats` returns the Dev team group with both topics, and `visibleChats` includes both topics;
   - `bug` → only the Bugs topic under Dev team;
   - `ana` → only the DM;
   - an empty search → everything.

### Read first
`AGENTS.md`, `apps/web/src/store/store.ts` (lines 1440-1545), `apps/web/src/store/folders.test.ts`.

### Allowed files
`apps/web/src/store/store.ts`, `apps/web/src/store/search.test.ts`, `work/T-0316-web-search-group-name.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot store/search store/folders
pnpm gate
```

### Acceptance
- Searching a group's name shows that group with all its topics.
- Topic-name and DM-name search behave as before.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Did: made web chat-list search also match a group by its own name, in both
`visibleChats` and `groupChats` (`apps/web/src/store/store.ts`), and added
`apps/web/src/store/search.test.ts` with a "Dev team" group (topics General +
Bugs) plus an "Ana" DM covering the four spec cases.

Files changed:
- `apps/web/src/store/store.ts` — `visibleChats` also matches when
  `chat.groupTitle` contains the query; `groupChats` returns every topic of a
  group whose `groupTitleOf(topics[0])` contains the query, otherwise keeps the
  topic-title filter.
- `apps/web/src/store/search.test.ts` — new, 4 tests in `folders.test.ts` style.
- `work/T-0316-web-search-group-name.md` — this report + status.

Commands (real results):
- `pnpm install`: exit 0 (~11s).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot store/search store/folders`: 2 files, 8 tests passed.
- `pnpm gate`: GATE PASS — install PASS, format PASS, lint PASS, typecheck PASS,
  tests @zilar/web PASS, scope "every changed file is inside the Allowed files".
  Note: first gate run failed on prettier formatting of my two files; fixed with
  `pnpm exec prettier --write` on those two allowed files only, then re-ran the
  single test command (8 passed) and gate passed.

Problems / deviations: none. Query handling (trim + case-insensitive) reused as-is.

Security checklist: no secrets touched; no deletes/updates; no caps changed;
no permission logic touched; no new routes; no audit entries; group matching
uses only already-client-visible `groupTitle`.

Blocked / needs a decision: none.

Fix round 1: updated the `groupChats` doc comment only (group also matches when its own name contains the query, showing all topics); `pnpm gate` GATE PASS again.

## Review (written by Claude)

**Approved** after one lead fix round, for a stale doc comment on `groupChats`; it is now clean (Muse, peak).
- `groupChats` keeps every topic of a group whose own name contains the query, and `visibleChats` also matches `groupTitle`.
- The new `store/search.test.ts` covers group name, topic name, DM and empty search against the real store.
- This is the web twin of mobile T-0314.
