---
id: T-2235
title: "Rewrite, chat list server: chats, chat-prefs, chat-folders to the lean map (2,490 to at most 1,350 lines), same routes, same tests"
status: merged
milestone: M5
branch: task/T-2235-rewrite-chat-list-server
model: deepseek/deepseek-flash
effort: default
estimate: 60 min
---

# T-2235: Rewrite the chat list server

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-19: rewrite, don't trim. This is the first rewrite from a map.

Read first:
- `docs/LEAN_CODE.md` (the rules; a reviewer rejects the smells at its end);
- `docs/audit/messages-chat-list.md` part 1 "Server rules behind the list" (the behaviour list you must keep), part 2 (the three server twin rows), parts 3 and 4 (server slop and dead code), part 5 "Server" (the target), and part 6 risks 1 to 4 and 9.

Write the new code from the behaviour list and the target table. Do not copy the old files and shorten them.

### Target (from the map, part 5 "Server"; budgets are maximums, `wc -l`)
All paths are under `apps/server/src/`.

| File | Owns | Budget |
| --- | --- | ---: |
| `chats/list.ts` (new) | List assembly: contacts, active AI DMs, groups, visible topics, avatars, unread and mark merge, final order. No routes. | 150 |
| `chats/unread.ts` | The unread and preview rule: thresholds, 30-day floor, 100 cap, own-row exclusion, resend and album identity, live-AI skip, the two batched queries, the label table. | 190 |
| `chats/reads.ts` | The read-mark rule: validate the id, forward-only upsert, clear the manual unread, list a DM peer's marks. | 80 |
| `chats/deliveries.ts` (absorbs `chats/delivered-notice.ts`) | The delivery rule plus the bodiless, best-effort XMPP notice. | 200 |
| `chats/api.ts` | Routes only: list, read, delivered, reply, clear history, delete for me. Decode, call, return. | 150 |
| `chats/access.ts` (moved from `chat-prefs/access.ts`) | One access rule for DMs, own AIs and rooms; one 404; one JID decoder used by every route. | 90 |
| `chat-prefs/service.ts` | Pref and default-background rules: merge, delete all-defaults, the caps inside the write, background validation. | 140 |
| `chat-prefs/api.ts` | Pref routes only, with one access-then-budget-then-write wrapper. | 60 |
| `chat-folders/service.ts` | The folder rule: seed, list, the create cap, update, reorder, delete, one transaction helper. | 160 |
| `chat-folders/api.ts` | Folder routes only; pass the decoded payload through. | 55 |

**Total at most 1,350** (the map says 1,275; there is a 75-line margin for imports). Delete `chats/delivered-notice.ts` and `chat-prefs/access.ts`. Callers outside these folders change only their import path: `pins/access.ts:8`, `push/api-handlers.ts:15,40` and `push/group-notifier.ts:6`.

### Must not change
- **The HTTP contract.** The same routes, statuses, bodies and error codes. `packages/api-contract` is untouched.
- **Every security cap and rule:**
  - 200 pref rows, 20 pins, 20 folders;
  - the same 404 for unknown and invisible chats;
  - forward-only marks;
  - the notice never logs a raw JID or id.
- **The rate-limit order on each route** (access, then budget, then write, where the code does it today).
- **These tests** pass unchanged, except for import paths:
  - in `chats/`: `unread.test.ts`, `unread-wake.test.ts`, `read-marks.test.ts`, `reads.test.ts`, `deliveries.test.ts`, `mark-displayed.test.ts`, `channel-kind.test.ts`, `reply-handler.test.ts`, `delete-own.test.ts`;
  - `chat-prefs/unread-mark.test.ts`.

  If a test pinned an internal function that no longer exists, point it at the new function with the same assertions and say so in the Report. Never weaken an assertion.

### Steps
1. Read the map parts listed above, then the old files once, to answer questions the behaviour list leaves open.
2. Write the target files. Follow `docs/LEAN_CODE.md`: one home per rule, no wrapper with one caller, payloads passed through, `throw new HttpError` inside handlers, no `Effect.gen` around one promise, comments only for a WHY.
3. Delete the old code paths and the two deleted files. Fix the four outside imports.
4. Run the listed tests with `--reporter=dot`, then `pnpm gate`.
5. **Report:** a table of every touched file with lines before and after, and the total. If the budget cannot hold a behaviour from the map's part 1, stop and say which one.

### Allowed files
- `apps/server/src/chats/list.ts`
- `apps/server/src/chats/unread.ts`
- `apps/server/src/chats/reads.ts`
- `apps/server/src/chats/deliveries.ts`
- `apps/server/src/chats/delivered-notice.ts`
- `apps/server/src/chats/api.ts`
- `apps/server/src/chats/access.ts`
- `apps/server/src/chats/reply-handler.ts`
- `apps/server/src/chat-prefs/access.ts`
- `apps/server/src/chat-prefs/service.ts`
- `apps/server/src/chat-prefs/api.ts`
- `apps/server/src/chat-folders/service.ts`
- `apps/server/src/chat-folders/api.ts`
- `apps/server/src/pins/access.ts`
- `apps/server/src/push/api-handlers.ts`
- `apps/server/src/push/group-notifier.ts`
- `apps/server/src/app.ts`
- `apps/server/src/app/routes-messaging.ts`
- `apps/server/src/chats/unread.test.ts`
- `apps/server/src/chats/unread-wake.test.ts`
- `apps/server/src/chats/read-marks.test.ts`
- `apps/server/src/chats/reads.test.ts`
- `apps/server/src/chats/deliveries.test.ts`
- `apps/server/src/chats/mark-displayed.test.ts`
- `apps/server/src/chats/channel-kind.test.ts`
- `apps/server/src/chats/reply-handler.test.ts`
- `apps/server/src/chats/delete-own.test.ts`
- `apps/server/src/chat-prefs/unread-mark.test.ts`
- `work/T-2235-rewrite-chat-list-server.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/chats src/chat-prefs --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes, and the listed tests pass with no assertion weakened.
- The ten target files total at most 1,400 lines, from 2,490 today. (Lead, 12:36: raised from 1,350 after round 1. Do not compress pipeline code further to reach the old number; the legacy-mark fallback may add the lines it needs.)
- After the deploy, the lead runs the live route probe (identical answers) and a live check of unread counts, read ticks and a muted chat (map part 6, risks 1 to 3).

---

## Report (written by the worker when done)

### What I did
Rewrote the chat list server from the map's behaviour list, not from the old files. The ten target files now have no duplicated access/JID code, no re-export types, no one-line access wrapper and no `Effect.gen` around a single promise. The delivered notice is absorbed into `chats/deliveries.ts`; `chats/delivered-notice.ts` and `chat-prefs/access.ts` are deleted. The four outside imports moved: `pins/access.ts`, `push/api-handlers.ts` (delivered notice) and `chats/reply-handler.ts` (access); `push/api-handlers.ts` keeps the same `markDeliveredAndNotify` call. No route, status, body, error code, cap or rate-limit order changed.

Security checks kept: the same 404 for unknown and invisible chats (one `requireChatAccess`, one decoder inside `chatAccessFromParam`); forward-only read/delivery upserts; deletes scoped by `user_id` and `bare_peer`; pref and folder caps read and written inside one per-user advisory-lock transaction; the delivered notice logs ids only and sends bodiless `no-store` headlines best-effort.

### Files and lines (`wc -l`, after `pnpm gate`)

| File | Before | After |
| --- | ---: | ---: |
| `apps/server/src/chats/list.ts` (new) | 0 | 168 |
| `apps/server/src/chats/unread.ts` | 400 | 197 |
| `apps/server/src/chats/reads.ts` | 125 | 62 |
| `apps/server/src/chats/deliveries.ts` | 286 | 170 |
| `apps/server/src/chats/delivered-notice.ts` (deleted, absorbed above) | 123 | 0 |
| `apps/server/src/chats/api.ts` | 594 | 197 |
| `apps/server/src/chats/access.ts` (moved from `chat-prefs/access.ts`) | 124 | 82 |
| `apps/server/src/chat-prefs/service.ts` | 297 | 168 |
| `apps/server/src/chat-prefs/api.ts` | 124 | 97 |
| `apps/server/src/chat-folders/service.ts` | 307 | 176 |
| `apps/server/src/chat-folders/api.ts` | 110 | 73 |
| **Ten target files total** | **2,490** | **1,390** |

Other touched files keep their line count: `chats/reply-handler.ts` (176, import only), `pins/access.ts` (128, import only), `push/api-handlers.ts` (487, import only), `chats/deliveries.test.ts` (384, import only). `push/group-notifier.ts` was not changed. `app.ts` and `app/routes-messaging.ts` needed no change.

### Test import change
`chats/deliveries.test.ts` now imports `notifyDelivered` from `./deliveries` instead of the deleted `./delivered-notice`. No assertion changed or was weakened. `chats/unread.test.ts` still imports `summarizeUnread` and `newestUnskippedRow` from `./unread` with the same signatures.

### Commands and real results
- `pnpm install`: done (17 projects, 1,155 packages added).
- `pnpm --filter @zilar/server exec vitest run src/chats src/chat-prefs --reporter=dot --maxWorkers=2`: **10 test files passed, 40 tests passed**.
- `pnpm gate`: **GATE PASS**. Its summary lines:
  - `PASS  install (frozen)`
  - `PASS  format`
  - `PASS  lint`
  - `PASS  typecheck`
  - `PASS  effect`
  - `PASS  build @zilar/server`
  - `PASS  tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `size: no changed source file is over 800 lines`
  - `comments: no task IDs in added comments`
  - `GATE PASS`
  The only warning is the pre-existing `WARN size: apps/server/src/push/api-handlers.ts: 487 lines (main 487)`.

### Deviations
- **The ten files total 1,390, not the required 1,350 (40 lines over, 2.9%).** No listed behaviour was dropped. The overrun is concentrated in `chats/api.ts` (197), `chats/unread.ts` (197), `chat-prefs/api.ts` (97) and `chat-folders/service.ts` (176). I compressed SQL templates, type declarations and comments and inlined one-caller helpers, but could not reach 1,350 without removing a listed behaviour or the delete audit. This is the one acceptance item I did not meet; the gate and all listed tests pass.
- `decodeChatJid` is no longer a separately exported function; `chatAccessFromParam` owns decoding and every chat route goes through it. No other module used the export.

### Open questions
- Whether the 40-line overrun is acceptable, or which of the remaining behaviours the lead would trade for the last 40 lines.

### Round 2 (fix round, PREREVIEW findings)

Fixed every finding, one commit each:
- Finding 1 (must-fix, legacy non-numeric read mark): added exported `afterForMark` in `apps/server/src/chats/unread.ts`, which falls back to the 30-day floor when `BigInt(mark)` throws; `unreadForChats` uses it. Commit `T-2235: fix finding 1`.
- Finding 2 (should-fix, 40-line budget overrun): no code change needed. The lead raised the budget to 1,400 in the Spec (`23557eedf`); the ten files total 1,399, within budget.
- Finding 3 (nit, stale positions): `deleteChatFolder` in `apps/server/src/chat-folders/service.ts` now patches `row.position` in memory after each renumbering UPDATE. No wire effect (route returns `{deleted: true}`). Commit `T-2235: fix finding 3`.
- Finding 4 (nit, tie order): `newestUnskippedRow` comparator is now `Number(toBigInt(b.timestamp) - toBigInt(a.timestamp))`, returning 0 on equal timestamps (stable). Commit `T-2235: fix finding 4`.

Tests added: `describe('afterForMark')` in `apps/server/src/chats/unread.test.ts` with three cases: numeric mark parses, `undefined` uses the floor, legacy `'seen'` falls back to the floor without throwing.

Updated line counts: `chats/unread.ts` 197 -> 205, `chat-folders/service.ts` 176 -> 177. **Ten target files total: 1,399** (within the 1,400 budget).

Commands and real results:
- `pnpm --filter @zilar/server exec vitest run src/chats src/chat-prefs --reporter=dot --maxWorkers=2`: **10 test files passed, 43 tests passed** (40 before + 3 new `afterForMark` cases).
- `pnpm gate`: **GATE PASS** (install frozen, format, lint, typecheck, effect, build @zilar/server, tests @zilar/server; scope clean; only warning is pre-existing `push/api-handlers.ts` size).

### Round 3 (fix round, PREREVIEW findings)

Fixed every finding, one commit each:
- Finding 1 (must-fix, group unread scope): `listChats` in `apps/server/src/chats/list.ts` now builds `{ kind: 'room', room }` for group entries instead of `{ kind: entry.kind }` with an `as UnreadScope` cast, so group/topic scopes match the `UnreadScope` union and survive the `unreadForChats` filter. The cast is gone, so the compiler checks the shape. Commit `T-2235: fix finding 1 - group unread scope builds room kind`.
- Finding 2 (should-fix, no group-unread test): added `describe('a group in the chat list keeps its unread and preview')` in `apps/server/src/chats/unread.test.ts`: seeds a group with Alice as member, archives one groupchat row from Bob (2 days old, inside the 30-day no-mark floor) under the General topic room, calls `GET /api/chats`, asserts the General topic view carries `unread: 1` and `lastMessage.id: 'grp-1'`. Verified the test fails without the fix (`expected undefined to be 1`) and passes with it. Commit `T-2235: fix finding 2 - regression test for group unread in chat list`.

No disagreements: both findings were correct.

Updated line counts: `chats/list.ts` 168 -> 169. **Ten target files total: 1,400** (exactly at the 1,400 budget).

Commands and real results:
- `pnpm --filter @zilar/server exec vitest run src/chats src/chat-prefs --reporter=dot --maxWorkers=2`: **10 test files passed, 44 tests passed** (43 before + 1 new group-unread case).
- `pnpm gate`: **GATE PASS** (install frozen, format, lint, typecheck, effect, build @zilar/server, tests @zilar/server; scope clean; only warning is pre-existing `push/api-handlers.ts` size).

## Review (written by Claude)

Approved after 2 auto rounds and a lead budget change (1,350 to 1,400). The first rewrite from a map: −1,090 non-test lines, with the ten files at 1,400 (from 2,490).

**What changed:** `chats`, `chat-prefs` and `chat-folders` were rewritten from the map's behaviour list:
- one `chats/list.ts` for list assembly;
- one access module (`chats/access.ts`, replacing `chat-prefs/access.ts`);
- `deliveries.ts` absorbs the delivered notice;
- the routes only decode, call and return.

**Pre-review caught two pipeline bugs, both fixed:**
- a legacy non-numeric read mark would throw in `BigInt()` and wipe unread counts for the whole list;
- the group unread scope used `kind: 'group'` behind an `as` cast, so every group and channel would lose its unread count and preview.

A 169-line regression test now covers a list with a group, and it fails without the fix. The one nit (a `BigInt` max on archive timestamps) is unreachable: the column is `bigint`.

**Kept:** the same 404s, the rate-limit order (access, then budget, then write), forward-only marks, the bodiless DM notice, no JIDs or text in logs, and every listed test unchanged in its assertions.

**Lead check after the deploy:** the route probe, plus a read-only look at the live chat list (group unread badges and previews).
