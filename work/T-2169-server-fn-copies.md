---
id: T-2169
title: "One copy of each function written twice (server): identical function bodies in different files get one home; no behaviour change"
status: merged
milestone: M5
branch: task/T-2169-server-fn-copies
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2169: One copy of each function written twice (server)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: fewer lines, and one place to change each thing. The lead scanned every top-level function and arrow const at `91ff2a980`. Each row below is a group of functions whose bodies are identical after whitespace and comments are normalised, though the names may differ. Line numbers are where each copy starts.

| # | Copies |
| --- | --- |
| 1 | `apps/server/src/approvals/api.ts:72` `loadTopicRow`<br>`apps/server/src/routines/reads.ts:11` `findTopicById`<br>`apps/server/src/topics/access.ts:115` `getTopic` |
| 2 | `apps/server/src/routines/reads.ts:61` `findOwnedAiRow`<br>`apps/server/src/tools/access.ts:215` `findOwnedAiRow` |
| 3 | `apps/server/src/agents/gateway/fetch-media.ts:37` `humanSize`<br>`apps/server/src/agents/gateway/save-text-media.ts:36` `humanSize` |
| 4 | `apps/server/src/groups/ais.ts:99` `groupTopicRows`<br>`apps/server/src/routines/reads.ts:22` `listTopicsByGroup` |
| 5 | `apps/server/src/config/load.ts:287` `booleanFlagSchema`<br>`apps/server/src/push/config.ts:15` `booleanFlagSchema` |
| 6 | `apps/server/src/actions/support.ts:29` `safeStringify`<br>`apps/server/src/routines/support.ts:313` `safeStringify` |
| 7 | `apps/server/src/agents/listener/score.ts:141` `parseJson`<br>`apps/server/src/stickers/api-decode.ts:24` `parseJsonOrNull` |
| 8 | `apps/server/src/chat-prefs/api.ts:25` `decodePathJid`<br>`apps/server/src/chats/api.ts:299` `decodeChatJid` |
| 9 | `apps/server/src/agents/gateway/contracts.ts:256` `errorName`<br>`apps/server/src/effect/error-utils.ts:6` `errorName` |
| 10 | `apps/server/src/card-media/fetch.ts:446` `startsWith`<br>`apps/server/src/stickers/image.ts:88` `startsWith` |
| 11 | `apps/server/src/connections/base-url.ts:31` `bareHost`<br>`apps/server/src/connections/pinned-fetch.ts:33` `bareHost` |
| 12 | `apps/server/src/groups/schemas.ts:193` `mapXmppError`<br>`apps/server/src/topics/rooms.ts:94` `mapRoomError` |
| 13 | `apps/server/src/leader/start.ts:187` `serializeError`<br>`apps/server/src/machines/hub.ts:191` `serializeError` |
| 14 | `apps/server/src/message-blocks/apply.ts:20` `fieldOf`<br>`apps/server/src/routines/execute.ts:187` `readKey` |
| 15 | `apps/server/src/routines/execute.ts:173` `isSubset`<br>`apps/server/src/tools/adapter-support.ts:199` `isSubsetOf` |

### Steps
For each row:
1. Read every copy and confirm the bodies match.
2. Keep one copy:
   Prefer the module that owns the data: the topics module for topic rows, the ais or tools access module for owned-AI rows, `apps/server/src/effect/error-utils.ts` for error helpers. For small pure helpers, keep the copy in the file that the others already import from, or the more general one.
3. Export it, import it at the other places, and delete the other copies. When the names differ, keep the clearer name and rename the call sites.
4. **Skip a row and say why in the Report** when:
   - the copies differ after all;
   - sharing would need an import that breaks a package boundary (a package never imports an app; an app imports only packages it already depends on);
   - the copy is React Native or DOM markup that the other platform cannot render.

### Rules
- No behaviour change.
- Keep every "why" comment, once, on the kept copy.
- No new tests. Existing tests must pass. Update a test's import path only when its function moved.
- Do not touch `apps/server/src/auth/**`.
- `apps/server/src/connections/pinned-fetch.ts` is the outbound fetch guard; only its `bareHost` import may change.

### Allowed files
- `apps/server/src/actions/support.ts`
- `apps/server/src/agents/gateway/contracts.ts`
- `apps/server/src/agents/gateway/fetch-media.ts`
- `apps/server/src/agents/gateway/save-text-media.ts`
- `apps/server/src/agents/listener/score.ts`
- `apps/server/src/approvals/api.ts`
- `apps/server/src/card-media/fetch.ts`
- `apps/server/src/chat-prefs/api.ts`
- `apps/server/src/chats/api.ts`
- `apps/server/src/config/load.ts`
- `apps/server/src/connections/base-url.ts`
- `apps/server/src/connections/pinned-fetch.ts`
- `apps/server/src/effect/error-utils.ts`
- `apps/server/src/groups/ais.ts`
- `apps/server/src/groups/schemas.ts`
- `apps/server/src/leader/start.ts`
- `apps/server/src/machines/hub.ts`
- `apps/server/src/message-blocks/apply.ts`
- `apps/server/src/push/config.ts`
- `apps/server/src/routines/execute.ts`
- `apps/server/src/routines/reads.ts`
- `apps/server/src/routines/support.ts`
- `apps/server/src/stickers/api-decode.ts`
- `apps/server/src/stickers/image.ts`
- `apps/server/src/tools/access.ts`
- `apps/server/src/tools/adapter-support.ts`
- `apps/server/src/topics/access.ts`
- `apps/server/src/topics/rooms.ts`
- Test files next to those files (import path only).
- `work/T-2169-server-fn-copies.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down; give the net from `git diff main --numstat -- apps packages`.
- The Report lists each row: merged (where it lives now) or skipped (why).

---

## Report (written by the worker when done)

### What I did

Merged every row; no row was skipped. Kept copy per row:

| # | Kept in | Name kept | Other copies now import it |
| --- | --- | --- | --- |
| 1 | `topics/access.ts` | `getTopic` | `approvals/api.ts`, `routines/reads.ts` |
| 2 | `tools/access.ts` | `findOwnedAiRow` | `routines/reads.ts` |
| 3 | `agents/gateway/fetch-media.ts` | `humanSize` | `agents/gateway/save-text-media.ts` |
| 4 | `topics/access.ts` | `listTopicsByGroup` | `groups/ais.ts`, `routines/reads.ts` |
| 5 | `config/load.ts` | `booleanFlagSchema` | `push/config.ts` |
| 6 | `actions/support.ts` | `safeStringify` | `routines/support.ts` |
| 7 | `stickers/api-decode.ts` | `parseJsonOrNull` | `agents/listener/score.ts` |
| 8 | `chats/api.ts` | `decodeChatJid` | `chat-prefs/api.ts` |
| 9 | `effect/error-utils.ts` | `errorName` | `agents/gateway/contracts.ts` re-exports it |
| 10 | `stickers/image.ts` | `startsWith` | `card-media/fetch.ts` |
| 11 | `connections/base-url.ts` | `bareHost` | `connections/pinned-fetch.ts` |
| 12 | `groups/schemas.ts` | `mapXmppError` | `topics/rooms.ts` |
| 13 | `effect/error-utils.ts` | `serializeError` | `leader/start.ts`, `machines/hub.ts` |
| 14 | `message-blocks/apply.ts` | `fieldOf` | `routines/execute.ts` |
| 15 | `tools/adapter-support.ts` | `isSubsetOf` | `routines/execute.ts` |

Kept the existing "why" comments once on the kept copy (`getTopic`, `decodeChatJid`, `bareHost`, `config/load`'s `booleanFlagSchema`). No behaviour change and no new tests.

Product net from `git diff main --numstat -- apps packages`: 60 insertions, 187 deletions, **net -127 lines**.

### Checks run

```text
PASS  install (frozen)
PASS  format
PASS  lint
PASS  typecheck
PASS  effect
PASS  build @zilar/server
PASS  tests @zilar/server (113.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: no changed source file is over 800 lines
comments: no task IDs in added comments
GATE PASS
```

The first gate run failed `format` on `approvals/api.ts` and `routines/support.ts`; I ran `pnpm exec prettier --write` on those two files and the second gate run above passed. I did not run single test files separately; the gate ran the server test suite.

### Notes for the lead

- Three differing names were kept as the name already used outside the Allowed files: `getTopic`, `mapXmppError` and `isSubsetOf` (plus `decodeChatJid`, which moved to `chats/api.ts`). To avoid editing `routines/access.ts` and `routines/api.ts` (outside Allowed), `routines/reads.ts` re-exports `getTopic as findTopicById`, `listTopicsByGroup` and `findOwnedAiRow`; the function bodies exist once.
- Row 12 has a third identical copy of `mapXmppError` at `topics/service.ts:178`. It was not in the table and `topics/service.ts` is outside Allowed files, so I left it; it needs a follow-up task or that file to be allowed.
- Row 7's kept copy lives in `stickers/api-decode.ts` because it was already exported and used by two modules; `agents/listener/score.ts` imports it. No import cycle.
- Row 10 keeps `startsWith` in `stickers/image.ts` because `card-media/fetch.ts` already imports `isPng`/`isWebp` from there; the reverse direction would create a cycle.
- Row 5 makes `push/config.ts` import `config/load.ts`; `config/load.ts` does not import push code, so there is no cycle.


## Review (written by Claude)

Approved; the pre-review was clean. One follow-up: a third `mapXmppError` in `topics/service.ts:178` is not identical (it has an extra 409 branch) and is outside scope, so it stays.

Net −127 across 23 files; all 15 rows merged:
- the topic row loader (3 copies) and `listTopicsByGroup` now live in `topics/access.ts`;
- the owned-AI lookup is in `tools/access.ts`;
- the error helpers (`errorName`, `serializeError`) are in `effect/error-utils.ts`;
- `bareHost` is in `connections/base-url.ts`; the fetch guard only changed its import;
- the rest went to the module the other copy already imported from.

**Comments:** the "why" lines of the deleted copies already sit on the kept copies (the 404 for a malformed escape; the same 404 for a missing topic).

**Checks:** the gate ran the server tests. The lead runs the route probe after the push.
