---
id: T-0316
title: "Web fix: the chat list search also matches a group by its own name"
status: todo
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

## Review (written by Claude)
