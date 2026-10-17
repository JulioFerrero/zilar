---
id: T-1873
title: "Media cards M3b: the `fetch_media` model tool (url, kind image|file, name?) — schema, parse, tool-calls, offer next to post_blocks (group turns + owner DM), executor calls fetchCardMedia with the chat's media key, ≤4 per turn, fixed refusals; the gateway gets cardMediaDir from boot"
status: merged
milestone: M5
branch: task/T-1873-fetch-media-tool
model: auto
effort: default
depends_on: [T-1862, T-1872]
estimate: 45 min
---

# T-1873: The `fetch_media` tool (media plan M3, part b)

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/message-blocks-media.md` §6 M3** (Julio took every recommendation on 2026-10-17).
- **T-1862 built** `fetchCardMedia`.
- **T-1872 checks** that a card's media ids belong to the AI and the chat.
- **This task lets the model call it:** it fetches an https image or file, gets back an id, and puts the id in an `images` or `file` block.

### Facts (read by the lead on 2026-10-17)
- **`apps/server/src/card-media/fetch.ts`:**
  - `fetchCardMedia(deps, input)` (`:119`);
  - `deps` is `{ db, dir, resolver?, fetcher? }` (`:44-49`);
  - `input` is `{ aiId, roomJid, groupId?, topicId?, url, kind: 'image' | 'file', name? }` (`:51-59`);
  - it resolves to `{ ok: true, media: { id, mime, size, width?, height?, name } } | { ok: false, reason }` (`:61-71`). Every `reason` is fixed text;
  - **known gap:** a non-quota store failure **rejects** the promise (the T-1862 review), so the caller must catch.
- **The chat's media key** (also what T-1872 checks):
  - a group turn uses `context.roomJid`;
  - the owner's DM uses `session.aiJid`, never the owner's JID (`apps/server/src/agents/gateway/contracts.ts:205-207`; the read route resolves a DM through the viewer's DM peers, `apps/server/src/card-media/api.ts:79-96`).
- **`post_blocks` is the model to copy** along the whole call path:
  1. `apps/server/src/agents/tools/schemas.ts:20` (the name), the args schema (`:222-237`) and the `ParsedToolArguments` union (`:238-270`);
  2. `apps/server/src/agents/tools/parse.ts:108` (the known-name list) and `:202-215` (the branch);
  3. `apps/server/src/agents/tool-loop.ts:69-78` (the `ValidToolCall` union);
  4. `apps/server/src/agents/tool-calls.ts:223-233`;
  5. `apps/server/src/agents/tools.ts:21` and `:55` (re-exports);
  6. `apps/server/src/agents/tools/blocks-tool.ts` (the definition file pattern);
  7. `apps/server/src/agents/tools/definitions.ts:320` (`buildTools`, the owner DM) and `:352` (`buildGroupTools`);
  8. `apps/server/src/agents/gateway/tool-exec.ts`: the known-group-tool guard (`:140-147`) and the dispatch with its DM fallback (`:215-232`). The per-turn counter pattern is `savedFacts` (`:108-111`).
- **The gateway deps:** `AgentGatewayDeps` (`apps/server/src/agents/gateway/contracts.ts:36`). The gateway is created in `apps/server/src/startup/components.ts:214-238`, and `boot.cardMediaDir` is available there (`apps/server/src/startup/boot.ts:40`, `:155`).

### Steps
1. **`schemas.ts`:**
   - add `export const FETCH_MEDIA_TOOL = 'fetch_media'`;
   - add `FetchMediaArgsSchema`: `url` (trimmed, 1..2048), `kind` (literals `image` | `file`) and an optional `name` (trimmed, ≤100);
   - add the `ParsedToolArguments` member.
2. **`parse.ts`:** add the name to the known list and a branch like `post_blocks`.
3. **`tool-loop.ts` and `tool-calls.ts`:** add the `ValidToolCall` member and its mapping.
4. **New `apps/server/src/agents/tools/media-tool.ts`:** `FETCH_MEDIA_TOOL_DEF`. Description:

   > Fetch one https image (PNG, JPEG, WebP; at most 8 MB) or file (PDF, CSV, plain text; at most 25 MB) so a card can show it. Returns a media id: put the id in an `images` block (`items`) or a `file` block (`media`), never the URL.

   The params mirror the schema, with `additionalProperties: false`. Re-export it from `tools.ts` like `POST_BLOCKS_TOOL_DEF`.
5. **`definitions.ts`:** offer `FETCH_MEDIA_TOOL_DEF` right after `POST_BLOCKS_TOOL_DEF` in both `buildTools` and `buildGroupTools`.
6. **`contracts.ts`:** add `cardMediaDir?: string` to `AgentGatewayDeps`, with a one-line comment. **`components.ts`:** pass `cardMediaDir: boot.cardMediaDir`.
7. **New `apps/server/src/agents/gateway/fetch-media.ts`:** `runFetchMedia(deps, session, call, chat)` returns `ToolExecution`.
   - **No `cardMediaDir`** → `error: media is not available`.
   - **It calls `fetchCardMedia`** and catches a rejection → `error: the file could not be stored`.
   - **A refusal** → `error: <reason>`.
   - **Success:** `fetched: media id <id>, name <name>, size <human size, e.g. 12 KB>, format <CSV|PDF|TXT|PNG|JPEG|WEBP>[, <w>×<h>]. Put the id in an images or file block.`
   - It logs `{ aiId, tool, ok }` only, never the URL.
8. **`tool-exec.ts`:**
   - add `FETCH_MEDIA_TOOL` to the known-group-tool guard;
   - dispatch it like `post_blocks`: a group context → `{ roomJid: context.roomJid, groupId, topicId }`; the owner DM (`context === undefined && options?.dmJid !== undefined`) → `{ roomJid: session.aiJid }`; otherwise `invalid: unknown tool`;
   - cap it at 4 calls per turn with a counter like `savedFacts`; the 5th → `error: at most 4 media per turn`.
   - `tool-exec.ts` is 289 lines; keep it at most 400.
9. **No new tests.** The guard and stripper tests are T-1862's, and the id check is T-1872's. If an existing test lists the offered tools (for example `apps/server/src/agents/group-turn-card.test.ts`), update its expectation; that file then counts as allowed.

### Allowed files
- `apps/server/src/agents/tools/schemas.ts`
- `apps/server/src/agents/tools/parse.ts`
- `apps/server/src/agents/tool-loop.ts`
- `apps/server/src/agents/tool-calls.ts`
- `apps/server/src/agents/tools.ts`
- `apps/server/src/agents/tools/media-tool.ts`
- `apps/server/src/agents/tools/definitions.ts`
- `apps/server/src/agents/gateway/contracts.ts`
- `apps/server/src/startup/components.ts`
- `apps/server/src/agents/gateway/fetch-media.ts`
- `apps/server/src/agents/gateway/tool-exec.ts`
- `apps/server/src/agents/group-turn-card.test.ts`
- `work/T-1873-fetch-media-tool.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **`fetch_media` is offered wherever `post_blocks` is.**
- **A call stores the file** under the chat's media key and returns the id line.
- **Refusals and store failures** return fixed `error:` lines.
- **More than 4 calls in a turn** are refused.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- **`schemas.ts`**: added `FETCH_MEDIA_TOOL`, `FetchMediaArgsSchema` (trimmed `url` 1..2048, `kind` `image` | `file`, optional trimmed `name` ≤100) and the `ParsedToolArguments` member.
- **`parse.ts`**: added the name to the known list and a `fetch_media` branch like `post_blocks`, keeping `name` absent when the model omits it.
- **`tool-loop.ts` / `tool-calls.ts`**: added the `ValidToolCall` member and its mapping.
- **New `tools/media-tool.ts`**: `FETCH_MEDIA_TOOL_DEF` with the spec's description, params mirroring the schema and `additionalProperties: false`; re-exported from `tools.ts` next to `POST_BLOCKS_TOOL_DEF`.
- **`definitions.ts`**: `fetch_media` is appended right after `post_blocks` in both `buildTools` (owner DM) and `buildGroupTools`.
- **`contracts.ts`**: added optional `cardMediaDir` to `AgentGatewayDeps`; **`components.ts`** passes `boot.cardMediaDir`.
- **New `gateway/fetch-media.ts`**: `runFetchMedia(deps, session, call, chat)` calls `fetchCardMedia` with the chat's media key (group room + group/topic in a group turn, `session.aiJid` in the owner's DM), catches a store rejection as `error: the file could not be stored`, turns a refusal into `error: <reason>`, answers `error: media is not available` without a directory, and on success returns the `fetched: media id …, name …, size …, format …[, w×h]. Put the id in an images or file block.` line. Logs only `{ aiId, tool, ok }`. Implemented as an Effect generator with `Effect.runPromise` at the edge (the gate's effect ratchet rejects a plain `async`/`try` file).
- **`tool-exec.ts`**: `fetch_media` is in the known-group-tool guard; dispatch mirrors `post_blocks` (group context → room/group/topic, owner DM → `session.aiJid`, otherwise `invalid: unknown tool`); a per-turn counter caps it at 4 calls and the 5th returns `error: at most 4 media per turn`. File is 313 lines, under 400.
- **No new tests** (as the spec says); no existing test asserted the offered tool list, so no test file needed an edit.

### Checks run
- `pnpm install` → Done.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/tools/parse.test.ts src/agents/tools/desk-definitions.test.ts` → 2 files, 4 tests passed.
- `pnpm gate` (final run) →
  ```
  gate: 12 changed file(s) against main
  PASS  install (frozen)  (2.8s)
  PASS  format  (1.4s)
  PASS  lint  (0.9s)
  PASS  typecheck  (4.9s)
  PASS  effect  (1.0s)
  PASS  tests @zilar/server  (35.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into the Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- The 4-call cap counts calls, not successes (a refused fetch still consumes one of the four); tell me if you meant only successful fetches.
- `fetch_media` does not use an injected `fetchImpl`; `fetchCardMedia` owns its guarded transport, so gateway test doubles cannot intercept it. No gateway test needed it in this task.
- Deviation: none from the spec. The download/refusal wording comes verbatim from `fetchCardMedia`'s fixed reasons.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `0012ed07d` (clean, 1 comment nit). It merges after T-1872, so card ids are already checked.
- **The executor:**
  - it is offered where `post_blocks` is; a context-free non-DM turn stays an unknown tool;
  - at most 4 calls per turn;
  - the media key is the room in a group and `session.aiJid` in the owner's DM.
- **The runner** catches the store rejection, gives fixed `error:` lines and logs no URL.
- **Still open:** the live store sits on the container layer until Julio OKs D1 (NOW.md "For Julio"), so fetched files vanish on each deploy.

