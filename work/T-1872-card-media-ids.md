---
id: T-1872
title: "Media cards M4: post_blocks accepts a media id (images.items, file.media, place.map, event.map) only when this AI fetched it into this chat, else 'invalid: unknown media'; routine and tool.run cards drop media blocks/map fields (they cannot own media); one test"
status: merged
milestone: M5
branch: task/T-1872-card-media-ids
model: auto
effort: default
depends_on: [T-1862, T-1869]
estimate: 35 min
---

# T-1872: Validate media ids on cards (media plan M4)

## Spec (written by Claude, do not edit)

### Why
**This is `docs/plan/message-blocks-media.md` §6 M4** (Julio took every recommendation on 2026-10-17). A card's media block carries an id, never a URL (`packages/protocol/src/blocks-content.ts:16-25`, `:74-84`; `place.map` and `event.map` are ids too, `:27-35`, `:62-71`). The server must not post a card whose id belongs to another AI or another chat. Otherwise a member of both chats could be shown a file across chats. This is the permissions area, so it gets one test.

### Facts (read by the lead on 2026-10-17)
- **`apps/server/src/card-media/service.ts:134`:** `getCardMedia(db, id)` returns `CardMediaRow | undefined`. The row is `{ id, aiId, roomJid, … }` (`apps/server/src/db/rows-agents.ts:252-265`).
- **Which chat a media row belongs to,** as fixed for the next task (`fetch_media`), which stores it:
  - in a group turn, `roomJid` is the room JID;
  - in the owner's DM it is **the AI's own bare JID** (`session.aiJid`), because the read route resolves a DM through the viewer's DM peers (`apps/server/src/card-media/api.ts:79-96`, `apps/server/src/search/service.ts:149-163`).
- **`apps/server/src/agents/gateway/post-blocks.ts`:**
  - `createPostBlocksRunner(logger, send, record)` (`:43-47`);
  - `buildBlocksPayload` runs at `:92`, then the card is sent;
  - a bad card returns `{ content: \`invalid: ${reason}\` }`;
  - for a DM, `chat.kind === 'chat'` and `chat.roomJid` is the owner's JID.
- **The runner is created** in `apps/server/src/agents/gateway/tool-exec.ts:78-80`, and the tests create it at `apps/server/src/agents/gateway/post-blocks.test.ts:67`, `:99` and below.
- **The routine card path:** `routineBlocksPayload` builds at `apps/server/src/routines/outcomes.ts:60-85` (`buildBlocksPayload` at `:71`).
- **The `tool.run` card path** builds at `apps/server/src/tools/tool-adapters.ts:295`.
- Neither of those paths can fetch media.

### Steps
1. **New `apps/server/src/message-blocks/media-ids.ts`:**
   - `mediaIdsOf(blocks: readonly Block[]): string[]` returns the ids from `images.items`, `file.media`, `place.map` and `event.map`;
   - `withoutMedia(blocks: unknown[]): unknown[]` works on raw objects: it drops `images` and `file` blocks and removes the `map` key from `place` and `event` blocks.
2. **`post-blocks.ts`:**
   - add a fourth parameter `lookupMedia: (id: string) => Promise<CardMediaRow | undefined>`;
   - after a valid build, check every id from `mediaIdsOf(payload.data.blocks)`. A missing row, `row.aiId !== session.aiId`, or `row.roomJid` not equal to the chat's media key (`chat.kind === 'chat' ? session.aiJid : chat.roomJid`, compared case-insensitively) returns `{ content: 'invalid: unknown media' }` and posts nothing;
   - wrap the lookups in a try/catch. A failure returns the existing failed text.
3. **`tool-exec.ts:78-80`:** pass `(id) => getCardMedia(deps.db, id)`.
4. **`outcomes.ts`** (`routineBlocksPayload`) and **`tool-adapters.ts:295`:** pass `withoutMedia(blocks)` into `buildBlocksPayload`. If nothing is left, the existing invalid branch falls back to the plain post.
5. **Update the existing `createPostBlocksRunner(...)` calls** in `post-blocks.test.ts` with a lookup that returns `undefined`. Then add one test (`it`) covering:
   - an `images` card whose id belongs to another AI → `invalid: unknown media`;
   - another room's id → the same;
   - an unknown id → the same;
   - in all three, nothing is sent;
   - the AI's own id in the same room → posted.
6. **Every file stays at most 400 lines** (`tool-adapters.ts` is 366 now; keep the change to a few lines).

### Allowed files
- `apps/server/src/message-blocks/media-ids.ts`
- `apps/server/src/agents/gateway/post-blocks.ts`
- `apps/server/src/agents/gateway/post-blocks.test.ts`
- `apps/server/src/agents/gateway/tool-exec.ts`
- `apps/server/src/routines/outcomes.ts`
- `apps/server/src/tools/tool-adapters.ts`
- `work/T-1872-card-media-ids.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/gateway/post-blocks.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **An AI card with a media id it didn't fetch into this chat is refused** with `invalid: unknown media`.
- **Its own id posts.**
- **Routine and `tool.run` cards** never carry media ids.
- The tests pass, and so does the gate.

---

## Report (written by the worker when done)

### What I did

- **`apps/server/src/message-blocks/media-ids.ts`** (new): `mediaIdsOf(blocks)` collects ids from `images.items`, `file.media`, `place.map` and `event.map`; `withoutMedia(blocks)` works on raw objects, drops `images` and `file` blocks and deletes the `map` key from `place` and `event` blocks, leaving everything else untouched.
- **`apps/server/src/agents/gateway/post-blocks.ts`**: `createPostBlocksRunner` takes a fourth argument, `lookupMedia`. After a valid build, `checkMedia` looks up every card media id and answers `allowed`, `unknown` or `failed`:
  - missing row, `row.aiId !== session.aiId`, or `row.roomJid` differing case-insensitively from the chat's media key (`session.aiJid` for `chat`, `chat.roomJid` otherwise) → `unknown`, returned as `invalid: unknown media`, and nothing is sent or recorded;
  - a lookup that throws is logged with the error name (AI id and tool only) and returns the existing `error: the card could not be posted`.
- **`apps/server/src/agents/gateway/tool-exec.ts`**: passes `(id) => getCardMedia(deps.db, id)` into the runner.
- **`apps/server/src/routines/outcomes.ts`** and **`apps/server/src/tools/tool-adapters.ts`**: pass `withoutMedia(blocks)` (guarded by `Array.isArray`) into `buildBlocksPayload`; an empty or all-media set falls into the existing invalid branch and posts plain text.
- **`apps/server/src/agents/gateway/post-blocks.test.ts`**: every `createPostBlocksRunner` call now passes a `lookupNone` lookup; added one test covering another AI's id, another room's id and an unknown id (all `invalid: unknown media`, nothing sent), the AI's own id in the same room (posted), and the DM key being the AI's own JID (owner's JID refused, own JID posted).

### Checks run

- `pnpm --filter @zilar/server exec vitest run src/agents/gateway/post-blocks.test.ts --reporter=dot`: 7 passed (1 file), 0 failed.
- `pnpm gate`: `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server`, `scope: every changed file is inside the Allowed files`, `GATE PASS` (7 changed files against main).
- `wc -l` on every touched source file: largest is `post-blocks.test.ts` at 355 lines; all are under 400.

### Notes for the lead

- The media key for a DM is `session.aiJid`, matching the read route's DM resolution described in the spec. The test checks both the refused owner-JID case and the accepted own-JID case.
- `withoutMedia` is applied only when the input is an array; a non-array still goes to `buildBlocksPayload`, which returns the usual invalid reason (no new failure mode).
- No deviations from the Spec; no files outside the Allowed list.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `f7a943bf1`.
- **`checkMedia`** compares each id's row with this AI and with the chat's media key (`session.aiJid` in a DM, the room JID in a group), case-insensitively.
  - A missing row, another AI's row and another chat's row all answer `invalid: unknown media`, so ids can't be probed.
  - A lookup error answers the failed text.
- **The routine and `tool.run` paths** pass `withoutMedia(blocks)`.
- **The new test** covers all three refusals plus the allowed post.
- **Next:** T-1873 (the `fetch_media` tool) can merge after this.

