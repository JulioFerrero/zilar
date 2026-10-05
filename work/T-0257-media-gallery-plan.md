---
id: T-0257
title: "Audit and plan: shared media gallery per chat (photos, files, links, voice), Telegram style, web first, docs only"
status: merged
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

Status: review. Docs-only task, no code, config, schema or package changes.

### What I did

- Read `AGENTS.md` and the task in full, plus the four "Read first" items
  (`attachment.ts`, `docs/SEARCH_NOTES.md`, `apps/server/src/search/*`,
  `GroupPanel.tsx`).
- Traced every media kind to its real storage and tables, the download path, and
  what the server knows without MAM; checked whether search indexes
  attachments/links.
- Wrote `docs/audit/media-gallery-plan.md` with the five required sections:
  Today (with `file:line` for every claim), Telegram behaviour to copy, Design
  (data source comparison, endpoint, access rules, web entry points), a three-task
  split with Allowed files/tests/risks, and open questions with recommendations.

### Files changed

- `docs/audit/media-gallery-plan.md` (new, the deliverable)
- `work/T-0257-media-gallery-plan.md` (status + this Report)

No other files. I did not touch `pnpm-lock.yaml`.

### Commands run (real results)

- `pnpm install` → `Done in 13.9s`, exit 0.
- `pnpm gate` (from repo root) → exit 0:

  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (30.2s)
  PASS  lint  (1.9s)
  PASS  typecheck  (1.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

I ran no single test file: the task is documentation-only and has no tests, and
the gate's test phase covers the untouched packages. The checks section asked only
for `pnpm gate`.

### Verified facts the plan rests on (spot-check)

- Payloads: `packages/protocol/src/payload.ts:14-37` (voice 34, attachment 35,
  sticker 36); attachment schema `packages/protocol/src/attachment.ts:10-22`.
- Upload: XEP-0363 slot `packages/xmpp-core/src/client.ts:1045-1055`; storage
  `infra/ejabberd/ejabberd.yml:78,198-205`; proxy `deploy/caddy/Caddyfile:39-44`.
- No media/messages table: `apps/server/src/db/schema.ts` (closest are
  `voice_transcripts` 42-47 and `pinned_messages` 573-593).
- Search matches body only: `apps/server/src/search/routes.ts:178-213`.
- Access set: `apps/server/src/search/service.ts:65-130`; blocks do not delete
  contacts: `apps/server/src/blocks/service.ts:86-102`.
- Group panel `?panel=group`: `apps/web/src/components/GroupPanel.tsx:44,46` and
  `apps/web/src/routes/ChatView.tsx:127-129`; no DM info panel today
  (`apps/web/src/routes/ChatView.tsx:126-135`).

### Problems / deviations

- None. The spec did not name a mobile screen, so I named
  `apps/mobile/src/app/group/[id].tsx` and the chat actions sheet from the repo
  tree; task 3 marks these as the proposed entry points, to confirm at spec time.
- The plan recommends a server-side index (Option A) over a client scan (Option C).
  The spec asked to compare, not to choose; I compare all three and recommend one.
- Task 1's exact migration filename is left as `<next>` (current head
  `0040_majestic_legion`) because drizzle chooses it at generate time.

### Open questions / needs a decision

The eight decisions are listed in section 5 of the plan with recommended answers.
None block this docs task; they should be settled before Task 1 is specced.

### Round — prereview fixes

- **Finding 1 (should-fix).** Task 3's Allowed files listed the directory
  `apps/mobile/src/store/` instead of full paths. Replaced it with the exact files
  the mobile media load/cache touches, mirroring Task 2's naming:
  `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/chat-store.ts`,
  `apps/mobile/src/store/real-store.ts`.
- **Findings 2 and 3 (nits).** Not changed: they are outside the line I touched, and
  the round instruction is to leave nits alone.
- **Tests added.** None. This is a docs-only round and the finding names no test; the
  gate's test phase covers the untouched packages.
- **Gate.** `pnpm gate` from the repo root → exit 0:

  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (15.4s)
  PASS  lint  (0.6s)
  PASS  typecheck  (0.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

  No single test file was run: the round changes only docs and the finding names no
  test.

## Review (written by Claude)

**Verdict:** Approved; clean after 1 auto round (2 nits).
- The plan: a server index built from MAM (bounded and incremental like search), `GET /api/media` with paging, access through `allowedArchives` plus a block check, and a tab strip in `GroupPanel` plus a "Media" item for DMs.
- Task 1 adds a schema migration and depends on Julio's §5 choices (index source, the 12-month window, deleted media), so it waits for his answers.
