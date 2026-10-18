---
id: T-2058
title: "Reduce (server): four helpers written more than once become one each — queryRecord + STRICT_QUERY (files, media, gifs), the chat-param access check (mark-handlers, reply-handler), the private-topic visibility query (audit/list, topics/access) and the on-demand chat index (files, media) — no behaviour change"
status: merged
milestone: M5
branch: task/T-2058-server-shared-helpers
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2058: Four server helpers, one copy each

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: reduce the code. The lead's jscpd run (2026-10-18, on `310ba71b8`) found these server helpers copied verbatim. Moving each to one place keeps the access and visibility rules in one spot.

### Facts (read by the lead on 2026-10-18 at `c4c8d733e`)
1. **`queryRecord` and `STRICT_QUERY`.** The same 16 lines are in `apps/server/src/files/api.ts:69-84` (345 lines), `apps/server/src/media/api.ts:97-112` (325) and `apps/server/src/gifs/api.ts:71-86` (387). `apps/server/src/http/` already holds small helpers (`client-ip.ts`, `read-capped.ts`).
2. **The chat-param access check.**
   - `chatAccessForMark` in `apps/server/src/chats/mark-handlers.ts:30-51` (used at `:61` and `:103`) and `chatAccessForReply` in `apps/server/src/chats/reply-handler.ts:32-52` (used at `:164`) are identical.
   - Each one is: decode the URI param, a 404 on a bad escape, then `requireChatReadAccess` (`apps/server/src/chats/reads.ts:18-23`, 127 lines).
3. **The private-topic visibility query.** The same block, finding which private topic ids a user may see (direct `topic_members` rows plus role access through `topic_role_access` and `group_member_roles`), is in:
   - `apps/server/src/audit/list.ts:257-280` (315 lines);
   - `apps/server/src/topics/access.ts:152-177` (263 lines).

   This is a permission rule.
4. **The on-demand chat index.** The same block is in `apps/server/src/files/api.ts:~259-281` and `apps/server/src/media/api.ts:~188-208`: index a chat that has no rows yet, catch a defect, then log `{ userId, err: errorClassName }`. The only difference is the log message (`'files index failed'` against `'media index failed'`).

### Steps
1. **`queryRecord`.** Create `apps/server/src/http/query-record.ts` with `STRICT_QUERY` and `queryRecord`, and import them in the three API files.
2. **The access check.** Add `chatAccessFromParam(deps, encodedJid, userId)` to `apps/server/src/chats/reads.ts`, with the comment kept. Both handlers use it. Keep `chatAccessForMark`'s name only if a test imports it; check with `git grep`.
3. **Visibility.** Export `visiblePrivateTopicIds(db, privateIds, userId): Promise<Set<string>>` from `apps/server/src/topics/access.ts`. `topics/access.ts` and `audit/list.ts` both call it.
4. **The index.** Add one `indexChatOnDemand(deps-like args, logMessage)` next to `indexChat`; find its module with `git grep -n "export.*function indexChat"`. Files and media both call it, each with its own log message.
5. **Tests.** No new tests. Run the nearest existing ones:
   - `topics/visible-batch.test.ts`
   - `chats/read-marks.test.ts`
   - `chats/reply-handler.test.ts`
   - `files/routes.test.ts`
   - `media/indexer.test.ts`
6. **Size.** Product lines must drop by at least 50. Report the counts. Every file stays at or under 400 lines.

### Allowed files
- `apps/server/src/http/query-record.ts`
- `apps/server/src/files/api.ts`
- `apps/server/src/media/api.ts`
- `apps/server/src/gifs/api.ts`
- `apps/server/src/chats/reads.ts`
- `apps/server/src/chats/mark-handlers.ts`
- `apps/server/src/chats/reply-handler.ts`
- `apps/server/src/topics/access.ts`
- `apps/server/src/audit/list.ts`
- `apps/server/src/media/indexer.ts`
- `apps/server/src/files/routes.test.ts` (added by the lead on 2026-10-18 for the fixture fix round)
- `work/T-2058-server-shared-helpers.md`

If `indexChat` lives in a file other than `apps/server/src/media/indexer.ts`, put the helper in the API file that is smaller, and say so in the Report.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/topics/visible-batch.test.ts src/chats/read-marks.test.ts src/chats/reply-handler.test.ts src/files/routes.test.ts src/media/indexer.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- Product lines are at least 50 lower.

---

## Report (written by the worker when done)

### What I did

- **`queryRecord` + `STRICT_QUERY`:** new `apps/server/src/http/query-record.ts`; `files/api.ts`, `media/api.ts` and `gifs/api.ts` import them and their local copies are gone.
- **Chat-param access check:** added `chatAccessFromParam(deps, encodedJid, userId)` to `chats/reads.ts` (with the bare-JID/404 comment) and a small `ChatAccessDependencies` interface (`db` + `config.xmpp`) so `reads.ts` does not import `chats/api.ts`. Both `mark-handlers.ts` and `reply-handler.ts` call it; `chatAccessForMark` and `chatAccessForReply` are deleted. `git grep` showed no test imports either name (only work task files mention them).
- **Private-topic visibility:** exported `visiblePrivateTopicIds(db, privateIds, userId)` from `topics/access.ts`; `visibleTopics` and `audit/list.ts` both call it. No import cycle (`topics/access.ts` does not import `audit/list.ts`).
- **On-demand chat index:** added `indexChatOnDemand(input)` next to `indexChat` in `media/indexer.ts` (that is where `indexChat` lives, so the Allowed-files fallback was not needed). It wraps `indexChat` in a `try`/`catch` and logs `{ userId, err: errorClassName(error) }` with the caller's fixed message (`'files index failed'` / `'media index failed'`). It deliberately strips `logger` from the `indexChat` input, so a skipped-row log still has no logger exactly as before; the logger is only used for the failure warning. `files/api.ts` and `media/api.ts` call it.

**Size (product lines, `wc -l`, new file included):**

| File | before | after |
| --- | --- | --- |
| `files/api.ts` | 345 | 322 |
| `media/api.ts` | 325 | 299 |
| `gifs/api.ts` | 387 | 371 |
| `chats/reads.ts` | 127 | 155 |
| `chats/mark-handlers.ts` | 117 | 95 |
| `chats/reply-handler.ts` | 213 | 192 |
| `topics/access.ts` | 263 | 273 |
| `audit/list.ts` | 315 | 292 |
| `media/indexer.ts` | 340 | 360 |
| `http/query-record.ts` | 0 | 21 |
| **total** | **2432** | **2380** |

Drop: **52 lines** (acceptance: at least 50). Every changed file is under 400 lines (largest: `gifs/api.ts`, 371).

### Checks run

- `pnpm install`: done (20.2s).
- Single tests (per AGENTS.md): `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/visible-batch.test.ts src/chats/read-marks.test.ts src/chats/reply-handler.test.ts src/files/routes.test.ts src/media/indexer.test.ts` → **1 failed | 35 passed (36)**; the only failure is `src/files/routes.test.ts:386` (`answers 404 for a retracted row`: expected 404, received 200).
- `pnpm gate` summary lines:
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS build @zilar/server`
  - `FAIL tests @zilar/server`: `Test Files 1 failed | 21 passed (22)`, `Tests 1 failed | 126 passed (127)` — same `files/routes.test.ts:386`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE FAIL` (only because of that one test)

### Notes for the lead

- **The failing test predates this task.** I reproduced it on the unmodified branch HEAD: `git stash push -- apps/server/src`, ran `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/files/routes.test.ts` → same single failure at `:386`, then `git stash pop`. So the gate is red at base, not because of the refactor.
- Probable cause (not changed, it is outside this spec): in `media/indexer.ts` the retraction branch deletes with `sender_jid = ${senderJid}`, and `senderJidFor` for a DM returns `stanzaFrom(row.xml) ?? ''`. The test's retraction row has no `from`, so the delete uses `''` while the file row's sender is `<peer>/phone`; the file row survives and the route answers 200. Fixing that is a behaviour/security decision (T-1994 introduced the sender scope), so I left it alone. Tell me if you want a follow-up task for it; the fix would live in `media/indexer.ts` and/or the test fixture.
- No new tests were added, as specified.
- No files outside the Allowed list were touched; `http/query-record.ts` is the one new file and is listed.
- **Fix round (lead request, 2026-10-18):** the retract fixture now carries `from="${peer}/phone"`, and a new test proves a foreign sender's retraction leaves the file at 200 with its bytes; `vitest run src/files/routes.test.ts`: **19 passed**, `pnpm gate`: **GATE PASS** (install, format, lint, typecheck, effect, build, tests, scope, migration, images, size all pass).


## Review (written by Claude)

Approved; the pre-review was clean.
- **What changed.** One copy each of:
  - `queryRecord` and `STRICT_QUERY` (`http/query-record.ts`);
  - `chatAccessFromParam` (`chats/reads.ts`);
  - `visiblePrivateTopicIds` (`topics/access.ts`, used by audit);
  - `indexChatOnDemand` (`media/indexer.ts`).
- **Size.** −52 product lines.
- **Pre-existing failure.** The lead confirmed that `files/routes.test.ts:386` ("answers 404 for a retracted row") fails on main too. Its DM retract fixture has no `from`, and since T-1994 a retraction must come from the file's sender. Real ejabberd DM stanzas carry `from`, so this is a fixture bug. The lead's fix round on this task adds `from` to the fixture, plus a foreign-retract case that must stay 200. The merge gate refused until then.
