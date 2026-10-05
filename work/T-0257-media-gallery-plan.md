---
id: T-0257
title: "Audit and plan: shared media gallery per chat (photos, files, links, voice), Telegram style, web first, docs only"
status: todo
milestone: M5
branch: task/T-0257-media-gallery-plan
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0257: media gallery plan

## Spec (written by Claude, do not edit)

### Why
D28 in `docs/PROJECT_PLAN.md` (line 141) lists a media gallery as a must-have for a human-first daily chat. `grep -rli "gallery\|SharedMedia" apps/web/src` finds nothing. Before any code, the lead needs a plan built from the real code. This task writes a document only: NO code, config or package changes.

### Verified facts (do not re-derive)
- Payloads: `packages/protocol/src/payload.ts` lines 14-37. `attachment` (schema in `packages/protocol/src/attachment.ts`, `kind: 'image' | 'file'` at line 11), `voice` and `sticker` are payload types.
- History is ejabberd MAM. Message search exists on the server (`apps/server/src/search`, notes in `docs/SEARCH_NOTES.md`). Pinned messages live in `apps/server/src/pins`.
- The web chat panel for groups is `apps/web/src/components/GroupPanel.tsx`. Mobile has a group detail screen (find it under `apps/mobile/src/app`).

### What to write: `docs/audit/media-gallery-plan.md`
1. **Today:**
   - where attachments, voice notes, links and GIFs live, with `file:line`: the server storage and table if any, the access check for downloads, and what the server knows about a chat's media without reading MAM;
   - whether the search index (`apps/server/src/search`, `docs/SEARCH_NOTES.md`) already records attachments or links.
2. **Telegram behaviour to copy:**
   - the chat info panel with tabs Media, Files, Links, Voice (and GIFs);
   - a grid for photos and lists for the rest;
   - tapping an item opens it or jumps to the message.
   Say what we take now and what later.
3. **Design:**
   - the data source (a server index table filled when messages are sent or indexed, or a client scan of loaded history; compare the cost and the correctness of each);
   - the endpoint shape with paging;
   - access rules (members only, private topics, blocked people, deleted messages);
   - the web UI entry point in the group and DM panel.
4. **Task split:** ordered small tasks (server index plus endpoint with one schema migration, web panel tabs, then mobile). For each: Allowed files with full paths, tests, and the risks. Note that only one database-schema task may run at a time.
5. **Open questions for Julio**, each with a recommended answer.

### Read first
`AGENTS.md`, `packages/protocol/src/attachment.ts`, `docs/SEARCH_NOTES.md`, `apps/server/src/search` (the indexer), `apps/web/src/components/GroupPanel.tsx`.

### Allowed files
`docs/audit/media-gallery-plan.md` (new), `work/T-0257-media-gallery-plan.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- Every claim about today's code has a `file:line`. The task list is small enough to spec straight from it.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

---

## Report (written by the worker when done)

## Review (written by Claude)
