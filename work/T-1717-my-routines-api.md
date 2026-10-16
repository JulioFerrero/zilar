---
id: T-1717
title: "GET /api/routines (listMine): every routine of every AI the caller owns, across chats, with aiName, aiAvatarUrl and chatName — the read behind the approved Settings › Routines page (Julio 2026-10-16)"
status: merged
milestone: M5
branch: task/T-1717-my-routines-api
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1717: One list of all my routines

## Spec (written by Claude, do not edit)

### Why
Julio approved a Settings › Routines page on 2026-10-16 (`docs/design/mockups/routines/`, `WebRoutinesList.dc.html` and `PhoneRoutinesList.dc.html`): every routine he runs, grouped Running and Paused. Each row shows the AI's picture, the title, the schedule, the AI's name and the chat. Today routines can only be listed per AI or per group. This task adds the server read; the web and phone pages are the next tasks.

### Facts (the lead read them on 2026-10-16)
- **`packages/api-contract/src/routines.ts`:**
  - `Routine` schema (`:9-26`): `id`, `aiId?`, `groupId?`, `topicId?`, `kind?`, `toolId?`, `title`, `toolName`, `schedule`, `status`, `pausedReason`, `nextRunAt`, `lastRunAt`, `lastStatus`, `approvedHosts`, `scope?`;
  - `RoutinesGroup` (`:32-58`): `listForAi` is `GET /ais/:id/routines`, plus `listForGroup`, `pause`, `resume` and `remove`, with prefix `/api`.
- **`apps/server/src/routines/api.ts`** (166 lines), the `listForAi` handler (`:55-78`):
  - checks ownership with `findOwnedAiRow(db, aiId, user.id)`;
  - lists with `listRoutinesForAi(db, ai.id)` (`apps/server/src/routines/queries.ts:50-62`);
  - keeps a routine only when its `topicId` is null or `canSeeTopic(db, topic, user.id)`;
  - maps each with `toListWire` (`apps/server/src/routines/wire.ts:3-22`).
- **AI pictures:** `apps/server/src/ais/api.ts:112-127` gets them with one query for a list: `avatarIdsByOwner(db, 'ai', ids)`, then `avatarUrlFor(id)` (`apps/server/src/avatars/service.ts:39-41`, `:250`).
- **`apps/server/src/routines/queries.ts`** is 155 lines and `apps/server/src/routines/reads.ts` is 71 lines.

### Steps
1. **Contract:**
   - add `MyRoutine = Routine` extended with `aiName: Schema.String`, `aiAvatarUrl: Schema.optional(Schema.String)` and `chatName: Schema.NullOr(Schema.String)`. `chatName` is the topic name, or the group name when the topic is General, or null for a personal chat; read the topic and group rows to see which name General uses;
   - add the endpoint `HttpApiEndpoint.get('listMine', '/routines', { success: Schema.Array(MyRoutine) })`.
2. **Server:**
   - in `reads.ts`, add one query for the caller's non-deleted routines across all AIs they own (`JOIN ais ON ais.owner = ${userId}`), plus the AI names;
   - apply the same `canSeeTopic` filter as `listForAi`;
   - resolve the chat names with at most one query for the topics and one for the groups;
   - add the avatars with one `avatarIdsByOwner` call;
   - handle `listMine` in `api.ts`; order Running (`active`) first, then by title.
   - If `api.ts` or `reads.ts` would pass 400 lines, put the new read in a new `apps/server/src/routines/mine.ts`.
3. **Test** (permissions): new `apps/server/src/routines/mine.test.ts`, on the real test database, through the read function or the route the way the existing routine tests seed data:
   - the caller sees routines of their own AIs, with the right `aiName` and `chatName`;
   - **another user's AI's routines are never returned**;
   - a routine in a private topic the caller can't see is left out.

### Allowed files
- `packages/api-contract/src/routines.ts`
- `apps/server/src/routines/api.ts`
- `apps/server/src/routines/reads.ts`
- `apps/server/src/routines/mine.ts`
- `apps/server/src/routines/mine.test.ts`
- `work/T-1717-my-routines-api.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/routines/mine.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **`GET /api/routines`** answers the caller's routines across all their AIs, with `aiName`, `aiAvatarUrl` and `chatName`.
- **Signed out,** it answers 401.
- **Another user's routines** are never included.
- **The new test passes.**

---

## Report (written by the worker when done)

### What I did

- **Contract** (`packages/api-contract/src/routines.ts`): added `MyRoutine = Routine` extended with `aiName: Schema.String`, `aiAvatarUrl: Schema.optional(Schema.String)` and `chatName: Schema.NullOr(Schema.String)` (built with `...Routine.fields`, like `ToolDetail` in `tools.ts`), and the endpoint `HttpApiEndpoint.get('listMine', '/routines', { success: Schema.Array(MyRoutine) })` on the existing `RoutinesGroup` (so it inherits the `Session` middleware → 401 signed out).
- **Server reads** (`apps/server/src/routines/reads.ts`): added `listRoutinesForOwner` (one query: `SELECT r.*, a.name AS ai_name FROM routines r INNER JOIN ais a ON a.id = r.ai_id WHERE a.owner = ${ownerId} AND r.deleted_at IS NULL`), a batched topics lookup and a batched group-titles lookup, and `listMyRoutines` which: filters each group-scoped routine through the same `canSeeTopic` check as `listForAi` (personal routines, `topicId === null`, are kept); resolves `chatName` as null for a personal chat, the topic name for a normal topic, and the group title for a General topic; and attaches avatars with one `avatarIdsByOwner(db, 'ai', ids)` call + `avatarUrlFor`.
- **Server route** (`apps/server/src/routines/api.ts`): added the `listMine` handler; it sorts Running (`active`) first, then by title (then id as a stable tiebreak) and maps through a local `toMyRoutineWire` that spreads `toListWire` and adds `aiName`/`aiAvatarUrl`/`chatName`.
- **Test** (`apps/server/src/routines/mine.test.ts`): three tests on the real PGlite test DB through `listMyRoutines`, seeding with the shared `seedUser`/`seedAi`/`seedGroup` helpers and `createPromptRoutine` (plus raw seeds for a private topic and an AI avatar): (1) the caller sees their own AIs' routines with the right `aiName`, `aiAvatarUrl` and `chatName` (null personal, group title for General); (2) another user's AI routines are never returned; (3) a routine in a private topic the caller cannot see is left out.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/mine.test.ts` → 1 file passed, 3 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/authz-sweep.test.ts` → 1 file passed, 5 tests passed (confirms `GET /api/routines` is registered and answers 401 without a session, and no route is skipped).
- `pnpm gate` (first run) → FAIL `format` on `apps/server/src/routines/mine.test.ts` and `apps/server/src/routines/reads.ts`; fixed with `pnpm exec prettier --write` on those two files only.
- `pnpm gate` (second run) → **GATE PASS**, summary:
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`
  - `SKIP tests @zilar/api-contract (no nearby test files)`, `PASS tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`

### Notes for the lead

- The spec allowed a new `apps/server/src/routines/mine.ts` only if `api.ts`/`reads.ts` would pass 400 lines; the new read went into `reads.ts` instead because `reads.ts` is 205 lines and `api.ts` 201 (gate's `size` check confirms both stay under 400). `mine.ts` was therefore not created.
- `MyRoutine` deliberately carries the same fields as the `Routine` list wire (it includes `scope` and no `prompt`), so the wire reuses `toListWire` and only adds the three fields.
- No route-level test was added: the spec allows testing through the read function, and the authz sweep (run above) covers the signed-out 401 for the new route. The Running-first ordering lives in the handler and is not covered by a test.
- `chatName` for a General topic uses `groups.title`; if the caller expects the literal topic name (`'General'`) there instead, that is a one-line change.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 1 nit (the handler's sort is untested), accepted.
- **The read:**
  - `listMyRoutines` joins `ais` with `a.owner = ${ownerId}` and `deleted_at IS NULL`;
  - the private-topic filter is the same `canSeeTopic` as `listForAi`;
  - names are batched (`IN` lists) and avatars come from one call.
- **The route:** `GET /api/routines` (`listMine`) sorts Running first, then by title.
- **The tests:** the lead ran `mine.test.ts` on the test database in the worktree: 3 passed, including the case where another user's routines are never returned.
- **`chatName` for General uses the group title,** which is what the board shows ("ai test"). Keep it.
