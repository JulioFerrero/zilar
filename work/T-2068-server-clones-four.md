---
id: T-2068
title: "Reduce (server, batch 4): one withServiceErrors wrapper (routines + tools), one 'send the group invite, then audit' join tail (public join + invite link), one 'reload, sync the room, audit' tail for topic adds (AI + member), one memory block-lines reader (compaction + recall), and one safe stored-file read (avatars + stickers) — no behaviour change"
status: merged
milestone: M5
branch: task/T-2068-server-clones-four
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2068: Server clones, batch 4

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: reduce the code. The lead's jscpd re-run (2026-10-18, on `10ac0deaf`) found five more server pairs. Two of them sit on access paths: the stored-file read that blocks path escape, and the join flow. One copy means one place to get right.

### Facts (read by the lead on 2026-10-18 at `848ab4f62`)
1. **`withServiceErrors`.** The function and its 4-line comment are identical in `apps/server/src/routines/status-errors.ts:20-29` (29 lines) and `apps/server/src/tools/wire.ts:168-177` (177 lines). Only the `mapServiceError` each file calls differs: different codes allowed through.
2. **The join tail.** Both joins finish the same way:
   - `syncPublicTopicsByLink(…, groupId)`;
   - `sendDirectInvitation`, logging a warn `'could not send the group invitations'` on failure;
   - then `deps.audit?.record({ actorUserId: userId, aiId: null, groupId, … })`.

   This is in `apps/server/src/groups/join.ts:164-179+` (209 lines) and `apps/server/src/invite-links/join.ts:190-205+` (301 lines).
3. **The topic-add tail.** Both adds continue the same way after their insert:
   - `getTopic`, a missing topic giving `toMissingTopic()`;
   - `syncTopicRoom`, a non-HttpError giving `xmppUnavailable()`;
   - then `deps.audit.record(toAuditEntry(updated, <action>, actor, <detail>))`.

   This is in `apps/server/src/topics/ais.ts:93-104+` (207 lines) and `apps/server/src/topics/members.ts:159-170+` (337 lines).
4. **The block lines.** This loop is identical in `apps/server/src/agents/memory/compaction.ts:40-54` (89 lines) and `apps/server/src/agents/memory/recall.ts:88-102` (102 lines):
   - `loadNodeMap`;
   - for each half: a summary line, or the half's non-deleted rows via `formatRow`.
5. **The stored-file read.** `apps/server/src/avatars/read.ts:51-65+` (69 lines) and `apps/server/src/stickers/storage.ts` `readStickerFile` (`:306+`, 337 lines) read a stored file the same safe way:
   - resolve the storage dir and join the stored key;
   - refuse when `dirname(filePath) !== storageDir`;
   - `readFile`.

### Steps
1. **`withServiceErrors`.** Make it generic over the mapper: `withServiceErrors(promise, map)`. Keep it once, in `routines/status-errors.ts`, exported. `tools/wire.ts` imports it and passes its own mapper. Keep the comment.
2. **The join tail.** Add one exported helper in `apps/server/src/groups/join.ts` holding the shared tail. Each caller passes its own deps, `groupId` and the audit's extra fields. The log text stays the same.
3. **The topic-add tail.** Add one exported helper in `apps/server/src/topics/members.ts` that reloads the topic, syncs the room and records the audit with a given action and detail. `topics/ais.ts` uses it.
4. **The block lines.** Export the loop once from `agents/memory/recall.ts`, and use it in `compaction.ts`.
5. **The file read.** Add one exported `readStoredFile(storageDir, storageKey)` in `apps/server/src/avatars/read.ts`, keeping the path-escape comment. It returns the bytes or `null`, and the sticker read uses it.
6. **Tests.** No new tests. Run the nearest existing ones (Checks).
7. **Size.** Product lines must drop by at least 30. Report the counts. Every file stays at or under 400 lines.

### Allowed files
- `apps/server/src/routines/status-errors.ts`
- `apps/server/src/tools/wire.ts`
- `apps/server/src/groups/join.ts`
- `apps/server/src/invite-links/join.ts`
- `apps/server/src/topics/ais.ts`
- `apps/server/src/topics/members.ts`
- `apps/server/src/agents/memory/compaction.ts`
- `apps/server/src/agents/memory/recall.ts`
- `apps/server/src/avatars/read.ts`
- `apps/server/src/stickers/storage.ts`
- `work/T-2068-server-clones-four.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/topics/ais.test.ts src/topics/one-step-add.test.ts src/topics/join-leave.test.ts src/stickers/api-upload.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- Product lines are at least 30 lower.

---

## Report (written by the worker when done)

### What I did

- **`withServiceErrors`**: `routines/status-errors.ts` now takes the mapper as a second argument, defaulting to the routines mapper. `tools/wire.ts` keeps its exported `withServiceErrors` (the routes import it) as a two-line wrapper that passes its own `mapServiceError`; the duplicate comment and body are gone.
- **Join tail**: added `finishJoin(deps, input)` in `groups/join.ts` holding the post-commit tail shared by `joinPublicGroup` and `joinByInviteLink`: add the newcomer to the public topics (the byte-identical best-effort block), `syncPublicTopicsByLink`, the direct invitation with its `'could not send the group invitations'` warn, then the audit record with the caller's action/subject/detail. Log fields and texts are unchanged. The stale `syncPublicTopicsByLink` comment (it no longer invites) was shortened.
- **Topic-add tail**: added `finishTopicAdd(deps, topicId, actorId, action, extra, record = true)` in `topics/members.ts`: reloads the topic (`toMissingTopic`), syncs the room (`HttpError` passes, anything else becomes `xmppUnavailable()`), then audits. `topics/ais.ts` and `addTopicMember` use it. `joinTopic` had the same tail with a conditional audit, so it uses the helper too with `record: inserted.length > 0` (the only caller passing `false`); same behaviour as before.
- **Block lines**: exported `blockLines(db, aiId, chatKey, block)` from `agents/memory/recall.ts` (node summaries or non-deleted rows per half) and used it in `zoomMemory` and `compactionInput`.
- **Stored-file read**: exported `readStoredFile(storageDir, storageKey)` from `avatars/read.ts` with the path-escape guard and comment; `readAvatarFile` and `readStickerFile` use it and keep their own `size` fallbacks (`row.bytes ?? bytes.byteLength` for avatars, `row.bytes` for stickers).
- No new tests, per the spec.

Size (`wc -l`, product files only): before 29 + 177 + 209 + 301 + 207 + 337 + 89 + 102 + 69 + 337 = **1857**; after 30 + 173 + 227 + 266 + 197 + 344 + 77 + 112 + 75 + 324 = **1825**, i.e. **32 lines fewer**. Every file is under 400 lines.

### Checks run

- `pnpm install`: completed (peer-dependency warning for `apps/mobile` `@types/react-dom` only, pre-existing).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/ais.test.ts src/topics/one-step-add.test.ts src/topics/join-leave.test.ts src/stickers/api-upload.test.ts`: **4 test files passed, 11 tests passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/visibility.test.ts src/invite-links/invite-links.test.ts src/avatars/access.test.ts`: **3 test files passed, 51 tests passed**. (No existing test file references the memory helpers directly.)
- `pnpm gate` (repo root), final run:
  ```
  gate: 11 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.0s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.2s)
  PASS  effect  (0.8s)
  PASS  build @zilar/server  (0.3s)
  PASS  tests @zilar/server  (29.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- `finishJoin` lives in `groups/join.ts` as the spec says, so `invite-links/join.ts` now imports it while `groups/join.ts` imports `syncPublicTopicsByLink`/`InviteLinkServiceDeps` from the `invite-links/service` barrel: a module cycle between the two join modules. Both sides only reference the other at call time (no top-level initialisation across the cycle), and the invite-link and public-join tests pass.
- `finishJoin` also absorbed the identical `addToPublicTopics` best-effort block that sat just before the three listed tail steps; without it the helper would have been larger than the code it replaced. Behaviour and log text are unchanged.
- `joinTopic` reusing `finishTopicAdd` is a small extension beyond the two adds named in the spec: it was the same tail with `inserted.length > 0 && deps.audit`, hence the `record` parameter.
- Security: the path guard (`dirname(filePath) !== dir`) and its comment are preserved in one place; audit detail fields are unchanged (ids and the link hint only); no new logging.

## Review (written by Claude)

Approved; the pre-review was clean.
- **What changed.** One copy each of:
  - `withServiceErrors`, taking a mapper;
  - `finishJoin`, the join tail;
  - the topic-add tail;
  - the memory block lines;
  - `readStoredFile`.
- **Size.** −32 product lines.
- **Security check by the lead.** `readStoredFile` keeps the path-escape guard: `dirname(join(dir, key)) !== dir` refuses the read, and the comment is kept. Avatars and stickers both used the same `resolveStorageDir` (`stickers/storage.ts:42`), so behaviour is unchanged.
- **Import cycle.** The join helper makes `groups` and `invite-links` import each other, but only at call time. Acceptable.
