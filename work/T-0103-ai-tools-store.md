---
id: T-0103
title: AI tools store: versioned tool code per AI and chat, history, revert, manual run, routes
status: review
milestone: M4
branch: task/T-0103-ai-tools-store
model: meta/muse-spark-1.3-contributor
depends_on: []
estimate: 1.5 days
---

# T-0103: AI tools store

## Spec (written by Claude, do not edit)

### Why
An AI that builds a tool ("every morning post the price of gold, the S&P 500 and BTC") must **keep** the code, let people see it, improve it by chat, and undo a bad change. Julio said "the AIs need their own git or something". We keep the same idea (an append-only history of versions with a message, a revert that itself becomes a new version) but store it in Postgres: transactional, backed up with the rest, testable with PGlite, and no filesystem or git process on the server. If tools ever move to runner desks with many files, this store can be exported to a real git repo.

This task builds the **store, the service and the HTTP routes**. The sandbox that runs the code is T-0102 (built in parallel); the AI-facing tools, the scheduler and the UI come later (T-0104 …). Here the runner is an injected port.

### Scope of a tool (Julio's rule for approvals, same here)
A tool belongs to **one AI and one chat**: `(ai_id, group_id)` where `group_id = null` means the personal chat between the AI and its owner. A tool made in a group is visible and usable only in that group. Same-name tools in different chats are different tools.

### Data model (`apps/server/src/db/schema.ts`; migration only with `pnpm --filter @galena/server db:generate`, never `npx`)
- `ai_tools`: `id` (uuid text like the other tables), `ai_id` (fk `ais`, on delete cascade), `group_id` (fk `groups`, nullable, on delete cascade), `name` (slug, see below), `description` (≤ 200 chars), `current_version` (int), `created_by` (user id: who asked for it), `created_at`, `updated_at`, `deleted_at` (nullable, soft delete). **Partial unique indexes** on `(ai_id, name)` where `group_id is null and deleted_at is null` and on `(ai_id, group_id, name)` where `group_id is not null and deleted_at is null` (same technique as `approval_rules`).
- `ai_tool_versions`: `id`, `tool_id` (fk cascade), `version` (int, from 1), `source` (text, ≤ 64 KiB), `hosts` (jsonb array of strings), `message` (≤ 200 chars, the "commit message"), `created_by`, `created_at`, unique `(tool_id, version)`. **Never updated or deleted by any service function** (append-only; the tests assert no update path exists by reading the history after every operation).
- `ai_tool_runs`: `id`, `tool_id` (fk cascade), `version`, `trigger` (`manual` | `routine` | `ai`), `status` (`ok` | `error`), `error_kind` (nullable), `duration_ms`, `fetch_count`, `output_text` (nullable, truncated to 2 KiB), `created_at`. Keep only the newest 50 runs per tool (prune in the same transaction that inserts).

### Rules for names and hosts (validate with `zod`, one shared schema)
- `name`: `^[a-z][a-z0-9_-]{1,39}$`.
- `description`: 1–200 chars, no control characters.
- `hosts`: 0–5 entries; each a lowercase DNS hostname (letters, digits, dots, hyphens; at least one dot; ≤ 253 chars; no scheme, port, path, wildcard, or IP literal). Normalise to lowercase and de-duplicate.
- `source`: 1–65 536 bytes (UTF-8 length, not characters).
- Limits per (AI, chat): 20 active tools; 200 versions per tool (beyond that → error `version_limit`).

### Service (`apps/server/src/tools/service.ts`, plus `schema` in `tools/schemas.ts`)
- `saveToolVersion(db, { aiId, groupId, name, description, source, hosts, message, userId }, now)`: creates the tool with version 1 if the name is new in that chat, otherwise appends version N+1 **only if** `source` or `hosts` differ from the current version (identical → returns the current version with `unchanged: true`, no row). Updates `description`, `current_version`, `updated_at`. All in one transaction; two concurrent saves of the same tool must end with consecutive version numbers and no duplicate (rely on the unique index and retry once, or lock the tool row).
- `listTools(db, { aiId, groupId })` (no source in the list, only name, description, current version, updated_at, hosts of the current version, last run status), `getTool(db, id)` (with current source), `listVersions(db, toolId)`, `getVersion(db, toolId, version)`.
- `revertTool(db, { toolId, toVersion, userId, message? }, now)`: appends a **new** version copying the old one's `source` and `hosts` with message `Revert to v<toVersion>` (history is never rewritten).
- `deleteTool(db, toolId, now)`: soft delete (name becomes reusable). `deleteToolsForAiInGroup(db, aiId, groupId, now)`: soft-deletes every tool of that AI in that group; called from `groups/service.ts` `removeGroupAi` (same place the approval rules are revoked, same transaction if the code there is transactional).
- `runToolVersion(deps, { toolId, version?, input, trigger }, now)`: loads the version (default current), calls the injected `ToolRunner` port with `{ source, input, allowedHosts: hosts }`, records an `ai_tool_runs` row (status, error kind, duration, fetch count, truncated output text), returns the runner's result. **The AI must be `active`** (status not `stopped`/`provisioning`): otherwise throw a typed `ToolServiceError('ai_not_active')` **before** calling the runner (kill switch). The port:
  ```ts
  export type ToolRunner = (params: { source: string; input: unknown; allowedHosts: readonly string[] }) => Promise<ToolRunResult>;
  export type ToolRunResult =
    | { ok: true; output: { text: string; data?: unknown }; logs: string; durationMs: number; fetchCount: number }
    | { ok: false; error: { kind: string; message: string }; logs: string; durationMs: number; fetchCount: number };
  ```
  (define these types in `tools/types.ts`; T-0102 will export a compatible type, the wiring is T-0105's job; do **not** import from `../sandbox`).

### Routes (`apps/server/src/tools/routes.ts`, mounted in `app.ts` under `/api`)
Access helpers: **reader** = the AI's owner, or (for a group tool) any member of that group; **manager** = the AI's owner, or (for a group tool) a group owner/admin. Anyone else gets the **same 404** as a missing id (no existence leak).
- `GET /api/ais/:id/tools` (AI owner; every chat's tools with `scope: 'personal' | 'group'` and `groupId`), `GET /api/groups/:id/tools` (any group member).
- `GET /api/tools/:id` (reader; includes the current source and hosts), `GET /api/tools/:id/versions` (reader; version, message, createdAt, createdBy, hosts; no source), `GET /api/tools/:id/versions/:n` (reader; with source), `GET /api/tools/:id/runs` (reader; newest 20).
- `POST /api/tools/:id/revert` `{ version }` (manager) → the new version; `DELETE /api/tools/:id` (manager, 204, idempotent); `POST /api/tools/:id/run` `{ input? }` (manager; rate limit 5 per minute per user through the existing limiter; answers the run result; 409 `ai_not_active`; **501 `runner_unavailable` when no runner is injected**).
- Audit entries (existing `audit.record`, never carrying source code or output): `tool.created`, `tool.updated`, `tool.reverted`, `tool.deleted`, `tool.run` (manual only) with `detail` `{ name, version }` (+ `{ status }` for runs) and the AI/group ids.
- `app.ts` takes an optional `toolRunner` dependency and passes it to the routes; **this task does not create a real runner** (T-0105 wires the sandbox).
- Update `authz-sweep.test.ts` so the new routes are covered by the same "401 without a session" sweep (allowlist unchanged).

### Read first
- `AGENTS.md` (mandatory)
- `apps/server/src/approvals/rules.ts`, `rules.routes.test.ts`, and the T-0099 Review in `work/T-0099-approval-rules-always-allow.md` (same scope model, partial unique indexes, 404 shape, revoke on group removal)
- `apps/server/src/db/schema.ts`, `apps/server/src/audit/` (recorder API), `apps/server/src/rate-limit.ts`, `apps/server/src/groups/service.ts` (`removeGroupAi`), `apps/server/src/authz-sweep.test.ts`, `apps/server/src/test-support.ts`
- `docs/PROJECT_PLAN.md` §12 (why versions and attribution matter)

### Allowed files
- `apps/server/src/tools/**` (new)
- `apps/server/src/db/schema.ts` and the generated migration in `apps/server/src/db/migrations/` (+ its meta files)
- `apps/server/src/app.ts` (mount the routes, optional `toolRunner` dep)
- `apps/server/src/groups/service.ts` (+ its test file) (only the call to `deleteToolsForAiInGroup`)
- `apps/server/src/audit/**` only if the audit action names live in a list there that needs the five new names
- `apps/server/src/authz-sweep.test.ts`
- `work/T-0103-ai-tools-store.md`

**Not allowed:** sandbox code, the agents/AI loop, actions/gateway, web, mobile, dependencies, `docs/`.

### Tests (Vitest, PGlite; a fake `ToolRunner`; no network)
- Service: create → v1; save with a changed source → v2; identical save → unchanged, still v1 (one row); hosts change alone → new version; name/description/host/size validation (including IP literal, wildcard, port, uppercase normalised, 6 hosts, 65 537-byte source); the same name in a personal chat and in a group are two tools; a deleted name can be reused; 20-tool and 200-version limits; two concurrent saves → v2 and v3, no duplicate; history rows are never modified (compare snapshots before/after revert and delete); revert creates a new version with the old content and the standard message and leaves older versions intact; group removal soft-deletes that AI's tools in that group only.
- Run: the fake runner receives exactly `{ source, input, allowedHosts }` of the chosen version; a run row is written and pruned to 50; long output is truncated to 2 KiB in the row; a stopped AI → `ai_not_active` and the runner is **not** called; runner failure is recorded as `error` with its kind and does not throw.
- Routes: 401 without a session; the AI owner lists/reads/runs/reverts/deletes; a plain group member can read (list, get, versions, runs) but gets 404 on revert/delete/run; a group admin who is not the owner can revert/delete/run a group tool but cannot see the owner's personal-chat tools (404); a stranger gets 404 everywhere and the body is identical to a missing id; run returns 501 without a runner, 409 for a stopped AI, 429 after the rate limit; audit rows exist for create/update/revert/delete/run and **contain no source or output** (assert on the serialised detail).
- The migration applies on a clean PGlite database (the existing migration test harness) and the schema check in the existing tests still passes.

### Acceptance criteria
- [ ] A tool's history is append-only and a revert is a new version.
- [ ] A tool is only ever visible to its chat's participants (owner / group members) and only manageable by the owner or a group admin; strangers cannot tell a tool exists.
- [ ] A stopped AI's tools cannot run.
- [ ] No source code or tool output in audit entries or logs.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint re-run after your last edit.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test
pnpm build
```

### Out of scope
- The sandbox, the real runner wiring, the AI's `write_tool`/`run_tool`, routines and scheduling, approval cards, all UI, diffs between versions (the client can diff), usage or cost tracking.

---

## Report (written by the worker when done)

### What I did
- Implemented the AI tools store end to end: versioned tool code per (AI, chat),
  append-only history, revert-as-new-version, soft delete, manual runs through an
  injected `ToolRunner` port, and HTTP routes with reader/manager access control.
- Data model (`apps/server/src/db/schema.ts`, migration
  `apps/server/drizzle/0017_plain_warstar.sql` generated via `pnpm --filter
  @galena/server db:generate`): `ai_tools` (soft delete, two partial unique
  indexes on `(ai_id, name)` / `(ai_id, group_id, name)` for active names, same
  technique as `approval_rules`), `ai_tool_versions` (unique `(tool_id,
  version)`, never updated/deleted by service code), `ai_tool_runs` (indexed on
  `tool_id`).
- Validation (`apps/server/src/tools/schemas.ts`, one shared zod schema):
  name slug, 1–200 char description/message with no control characters, hosts
  0–5 normalised to lowercase and de-duplicated (dot required; rejects scheme,
  port, path, wildcard, IP literal), source 1–65 536 UTF-8 bytes, 20-tool and
  200-version caps.
- Service (`apps/server/src/tools/service.ts`): `saveToolVersion` (v1 create or
  N+1 append only when source/hosts differ, `unchanged: true` otherwise, row
  lock + unique-index retry for concurrent saves), `listTools`/`getTool`/
  `listVersions`/`getVersion`, `revertTool` (`Revert to v<N>` new version),
  `deleteTool` (idempotent soft delete), `deleteToolsForAiInGroup` (called from
  `removeGroupAi` in the same transaction), `runToolVersion` (`ai_not_active`
  kill switch before the runner is called; run row with 2 KiB output
  truncation and prune-to-50 in the same transaction; runner failure recorded
  as `error`, never thrown). Audit `tool.created`/`tool.updated` via an
  optional recorder, detail `{ name, version }` only.
- Routes (`apps/server/src/tools/routes.ts`, mounted in `app.ts` with optional
  `toolRunner` dep; no real runner — T-0105's job): all nine endpoints with
  reader (AI owner / any group member for group tools) vs manager (AI owner /
  group owner/admin) gates and identical 404s for strangers; revert/delete/run
  manager-only; DELETE idempotent 204 via raw-row manager check; run rate
  limited 5/min/user, 501 `runner_unavailable` without a runner, 409
  `ai_not_active`; audit `tool.reverted`/`tool.deleted`/`tool.run` with detail
  `{ name, version }` (+`status` for runs), never source/output.
- Tests: `service.test.ts` (42 tests: all spec cases incl. concurrent saves →
  v2+v3, snapshot comparison of history rows across revert+delete, prune to
  50, 2 KiB truncation, stopped/provisioning AI never calls the runner) and
  `routes.test.ts` (all spec cases incl. 401 sweep per route, 404-shape
  equality for strangers, 501/409/429, audit detail without source/output).
  Plus one `groups.test.ts` case: `removeGroupAi` soft-deletes that AI's group
  tools only. No `authz-sweep.test.ts` edit needed — the sweep discovers the
  new routes automatically (all answer 401) and the allowlist is unchanged. No
  `apps/server/src/audit/**` change needed — action names are free-form
  strings validated by the existing recorder schema.
- Spec deviations: none. `deleteToolsForAiInGroup` takes the caller's `tx`
  (as the `removeGroupAi` transaction) rather than `(db, aiId, groupId, now)`
  — same transaction requirement, T-0099 precedent. `saveToolVersion`
  returns an extra `created` flag and accepts an optional audit recorder (no
  create/update routes exist in this task; T-0104 will pass the recorder).

### Files changed
- `apps/server/src/tools/types.ts` (new: `ToolRunner`/`ToolRunResult` port)
- `apps/server/src/tools/schemas.ts` (new: shared zod validation)
- `apps/server/src/tools/service.ts` (new: store logic)
- `apps/server/src/tools/routes.ts` (new: HTTP routes)
- `apps/server/src/tools/service.test.ts` (new: 42 tests)
- `apps/server/src/tools/routes.test.ts` (new: routes tests)
- `apps/server/src/db/schema.ts` (+ migration `0017_plain_warstar.sql` + meta)
- `apps/server/src/app.ts` (mount routes, optional `toolRunner` dep)
- `apps/server/src/groups/service.ts` (call `deleteToolsForAiInGroup`)
- `apps/server/src/groups/groups.test.ts` (+1 removal test)
- `work/T-0103-ai-tools-store.md` (this Report)

### Commands run and real results
- `pnpm install`: up to date (first run 7.9s, later reruns cached).
- `pnpm --filter @galena/server db:generate`: created `0017_plain_warstar.sql`;
  re-run after final edits: "No schema changes, nothing to migrate".
- `pnpm format:check`: pass ("All matched files use Prettier code style!").
- `pnpm lint` (oxlint): pass, re-run after last edit — pass.
- `pnpm typecheck`: 10/10 tasks successful.
- `pnpm exec vitest run src/tools src/groups --maxWorkers=2`: 3 files, 86
  tests, all pass.
- `pnpm exec vitest run src/authz-sweep.test.ts`: all 9 tools routes answer
  401 without a session; 5/5 sweep tests pass.
- `pnpm --filter @galena/server test -- --maxWorkers=2` (full suite, once):
  59 files passed, 5 skipped; 968 tests passed, 7 skipped, 0 failed.
- `pnpm build`: FULL TURBO (2 tasks successful).
- No `any`, no `@ts-ignore`, no disable comments (verified with grep).

### Problems, deviations from the spec, open questions
- During earlier sessions the machine was overloaded by parallel full test
  suites, which produced timeout flakes in unrelated files; per lead
  instruction I then ran only scoped suites while iterating and the full
  suite once at the end — green.
- Open question for the lead: `GET /api/tools/:id/runs` returns run rows
  including truncated `outputText` to readers (owner + group members). I read
  the "never carrying source code or output" audit rule as audit-only, so
  run output is visible via the API by design (it is the point of a run
  history). Confirm this is intended, otherwise gate output text to
  managers only in a follow-up.

### Blocked / needs a decision
- None.

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
