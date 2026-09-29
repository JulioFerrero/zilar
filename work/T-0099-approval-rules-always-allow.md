---
id: T-0099
title: "Approve always" as a standing rule scoped to one chat (M4, server)
status: review
milestone: M4
branch: task/T-0099-approval-rules-always-allow
model: meta/muse-spark-1.3-contributor
depends_on: [T-0090, T-0092, T-0093]
estimate: 1.5 days
---

# T-0099: "Approve always" for one chat

## Spec (written by Claude, do not edit)

### Julio's decision (2026-09-29)
"Approve always needs to be associated with the chat, like in personal or in groups, and apply only to that chat if approved always." So an "always" approval is a **rule for one AI + one chat + one action**: a group chat, or the personal chat (the owner's DM with that AI). It never applies anywhere else.

### Goal

Today `approve_always` behaves exactly like `approve_once` (single use). Make it real, safely, server side: deciding `approve_always` on an approval creates a standing **approval rule**; later requests for the **same AI, same chat, same action** run without a new card; the rule can be listed and revoked by the people who could have decided; everything is audited. Web UI comes in a later task (T-0100); do not touch web.

### Design (decided; follow it)

**Adapter opt-in.** `ActionAdapter` gets optional `allowAlways?: boolean` (default `false`). Only adapters that set it can be always-approved. `demo.echo` sets it to `true`. A rule is **never** honoured, and `approve_always` is **refused**, for an adapter with `estimateCost` returning an amount above 0 (money never gets a standing approval).

**Table `approval_rules`:** `id` (text pk), `ai_id` (fk `ais` cascade), `group_id` (nullable fk `groups` cascade; **`null` = the personal chat between the AI and its owner**), `action` (text), `created_by` (text, fk `user` cascade), `created_at`, `revoked_at` (nullable), `revoked_by` (nullable text). At most **one active rule** per (`ai_id`, `group_id` or null, `action`): enforce with partial unique indexes (one for `group_id IS NOT NULL`, one for `IS NULL`, both `WHERE revoked_at IS NULL`). Generate the migration with `pnpm --filter @galena/server db:generate` (**never `npx`**); if the number collides after a rebase, delete yours and regenerate.

**Creating a rule.** In `POST /api/approvals/:id/decision`, a decision `approve_always` by someone who may decide (existing `canDecide`) on a **pending** approval whose action is always-eligible creates the rule for (`approval.ai_id`, `approval.group_id`, `approval.action`) with `created_by` = the decider, **in the same transaction as the decision**; an existing active rule is kept (idempotent). If the action is not eligible (unknown to the registry, `allowAlways` false, or it has a cost), the decision is **refused** with 400 `always_not_allowed` and nothing changes. The routes get an optional dependency `alwaysEligible?: (action: string) => boolean`; absent means "nothing is eligible". The current request itself proceeds through the normal `onDecided` path (executes once).
- The public approval JSON (GET one, list, decision response) gains `alwaysEligible: boolean` so a client can decide whether to show the button. Keep every other field unchanged.

**Using a rule.** In `actions/gateway.ts` `request` (tier 2 path), after args validation and hash but **before** creating an approval: if an active rule exists for (`aiId`, `groupId ?? null`, `action`) **and the adapter is still eligible**, execute immediately (like the allow path): the AI is already known to be `active`; audit `action.auto_approved` (subject = rule id, `argsHash`, result `ok`) and then the usual `action.executed` / `action.failed`; return `executed`/`failed`; announce an outcome notice through the announcer with the summary prefixed `Ran automatically (always allowed in this chat): `. No approval row, no card. Everything else about the gateway is unchanged (a stopped AI is denied before any of this).

**Managing rules (routes, session required):**
- `GET /api/ais/:id/approval-rules` — the AI's **owner** only; lists active rules of that AI (personal chat and groups), each `{ id, action, scope: 'personal' | 'group', groupId, createdAt, createdBy }`.
- `GET /api/groups/:id/approval-rules` — group **owner/admin** only (or the owner of an AI, for that AI's rules — keep it simple: group owner/admin); lists active rules for that group.
- `DELETE /api/approval-rules/:id` — allowed for the AI's owner, or for the owner/admin of the rule's group; sets `revoked_at`/`revoked_by`; idempotent (already revoked → 204). Anyone else, or an unknown id → 404 (same shape, no leak).
- Audit entries: `approval_rule.created`, `approval_rule.revoked` (actor = the person; subject = the rule id; detail `{ action, scope }`), through the existing recorder, never throwing into the request.

**Lifecycle.** Removing an AI from a group (`groups/service.ts` `removeGroupAi`) and deleting the AI or group (cascade) must leave **no usable rule**: on removal, revoke the AI's active rules for that group in the same transaction. Rules never expire by time in v1 (say so in the Report as a follow-up idea).

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md` §15.1–15.4
- `work/T-0073-approvals-service.md`, `T-0090-action-gateway.md`, `T-0093-request-action-tool.md` (Reviews: pitfalls)
- `apps/server/src/approvals/service.ts` (`decideApproval`, `canDecide`, `toPublicApproval`), `routes.ts`, `actions/gateway.ts`, `registry.ts`, `demo.ts`, `groups/service.ts` (`removeGroupAi`), `audit/service.ts`, `db/schema.ts`, `app.ts`, `index.ts`

### Allowed files
- `apps/server/src/db/schema.ts` (the table) and the generated migration under `apps/server/drizzle/`
- `apps/server/src/approvals/` (a new `rules.ts` with the service and its routes, changes to `routes.ts`, `service.ts` for the transactional creation and `alwaysEligible`, tests)
- `apps/server/src/actions/registry.ts`, `gateway.ts`, `demo.ts` and their tests
- `apps/server/src/groups/service.ts` and its tests (revoke on removal only)
- `apps/server/src/app.ts`, `index.ts` (wiring: rules routes, `alwaysEligible` from the registry, the gateway's rule lookup)
- `work/T-0099-approval-rules-always-allow.md`

**Not allowed:** web, mobile, packages, new dependencies, the agent gateway / reply code, any change that makes a tier-0/1 or non-eligible action skip its normal path.

### Tests (Vitest, PGlite, fakes)
- Rule creation: `approve_always` on an eligible action by the AI owner (personal chat) creates a rule with `group_id` null; by a group admin (group approval) creates a group-scoped rule; by a plain member, a stranger → 404 as today and no rule; on a non-eligible action (no `allowAlways`, or has cost) → 400 `always_not_allowed`, approval stays pending, no rule; deciding twice does not duplicate the rule; the same request still executes once.
- **Scope is exact:** a rule for (AI A, group G1, action X) does **not** apply to group G2, to the personal chat, to another AI, or to another action; a personal-chat rule does not apply in groups. Each case still creates a normal approval card.
- Using a rule: executes at once, no approval row, audit has `action.auto_approved` with the hash and no args text, the announcer got the prefixed notice; adapter throws → `failed`, error text nowhere; **stopped AI** with a rule → denied, nothing runs; rule revoked → next request needs a card again; adapter loses eligibility (registry without `allowAlways`) → rule ignored and a card is created.
- Routes: list for the owner / group admin / stranger (404) / plain member (404); revoke by owner and admin, by stranger (404), idempotent; audit entries written and contain no args.
- Lifecycle: removing the AI from the group revokes that group's rules (personal and other-group rules untouched).
- Migration: `db:generate` reports no further changes; the authz sweep test (`authz-sweep.test.ts`) must still pass with the new routes answering 401 without a session (do not edit it; it discovers routes itself).
- Flow test: extend nothing outside the allowed files; put an end-to-end case for "approve always → second request auto-runs" in your new `approvals/rules.test.ts` using the real routes and gateway like `actions/flow.e2e.test.ts` does.

### Live check
Steps for Julio come with T-0100 (web). Say so.

### Acceptance criteria
- [ ] An always-approval never applies outside its exact (AI, chat, action).
- [ ] Money (cost above 0) and non-opted-in adapters can never be always-approved or auto-run.
- [ ] Revoke works immediately; removing the AI from the group kills its group rules.
- [ ] Every rule creation, use and revoke is audited without args.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint passes and is re-run after your last edit.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/server
pnpm build
```

### Out of scope
- Web and mobile UI (T-0100), rule expiry, per-args rules, cost budgets for rules.

---

## Report (written by the worker when done)

### What I did
- New `approval_rules` table (`apps/server/src/db/schema.ts` + migration `0016_glorious_lifeguard.sql` generated via `pnpm --filter @galena/server db:generate`, never `npx`): `id` pk, `ai_id` fk cascade, `group_id` nullable fk cascade (`null` = personal chat), `action`, `created_by` fk cascade, `created_at`, `revoked_at`/`revoked_by` (soft revoke); two partial unique indexes (`WHERE revoked_at IS NULL`, one for group rules, one for personal) enforcing at most one active rule per (AI, chat, action).
- New `apps/server/src/approvals/rules.ts`: `createRule` (idempotent, unique-violation re-read for races), `findActiveRule`, `listActiveRulesForAi`, `listActiveRulesForGroup`, `revokeRule` (idempotent), `revokeActiveRulesForAiInGroup`, `isGroupAdmin`, public shape `{ id, action, scope, groupId, createdAt, createdBy }`.
- Rule creation: `decideApproval` (`approvals/service.ts`) takes optional `alwaysEligible?: (action) => boolean` (absent = nothing eligible); `approve_always` on a non-eligible action throws `always_not_allowed` before any write (route maps to 400, approval stays pending); on an eligible pending approval by someone who passes `canDecide`, the decision + rule insert share one transaction; concurrent second rule insert falls back to the existing row (idempotent). Returns `{ row, rule }`; `toPublicApproval` gains `alwaysEligible: boolean` (default `false`; routes fill it via `decoratePublic`).
- Rule use: `actions/gateway.ts` `request` checks, for tier-2 + `allowAlways === true` + no `estimateCost` adapters and an `active` AI, an exact active rule for (`aiId`, `groupId ?? null`, `action`); on hit it executes immediately with no approval row and no card, audits `action.auto_approved` (subject = rule id, `argsHash`, no args) plus `action.executed`/`action.failed` (error text never stored/returned), and announces the outcome with summary prefixed `Ran automatically (always allowed in this chat): `. Stopped/disabled/missing AI is denied `ai_not_active` before the rule lookup (kill switch wins); cost (`estimateCost` present) is re-checked at use time, so an adapter that gains a cost after rule creation stops auto-running.
- Rule management routes (session required, in `approvals/routes.ts`): `GET /api/ais/:id/approval-rules` (AI owner only, else 404), `GET /api/groups/:id/approval-rules` (group owner/admin only, else 404), `DELETE /api/approval-rules/:id` (AI owner or group owner/admin; idempotent 204; stranger/member/unknown id all 404). Audits `approval_rule.created` (one entry per successful `approve_always`, even when the rule already existed) and `approval_rule.revoked` with `detail { action, scope }` and no args, via the existing recorder.
- Registry: `ActionAdapter.allowAlways?: boolean` (default `false`), `buildAlwaysEligible(registry)` predicate (registered + opted in + no `estimateCost`), startup rejection of `allowAlways + estimateCost`. `demo.echo` sets `allowAlways: true`.
- Lifecycle: `removeGroupAi` revokes the AI's active rules for that group in the same transaction (personal/other-group rules untouched); AI/group/user deletes cascade via FKs.
- Wiring: `index.ts` builds `alwaysEligible` from the real adapter registry; `app.ts` passes it and the gateway into the approvals routes. Web/mobile untouched. Live check steps come with T-0100 (web).
- Follow-up idea (per spec): rules never expire by time in v1 — consider expiry/TTL or re-confirmation in a later task.

### Files changed
- `apps/server/src/db/schema.ts`, `apps/server/drizzle/0016_glorious_lifeguard.sql`, `apps/server/drizzle/meta/0016_snapshot.json`, `apps/server/drizzle/meta/_journal.json` (prettier-formatted after generate)
- `apps/server/src/approvals/rules.ts` (new), `service.ts`, `routes.ts`
- `apps/server/src/actions/registry.ts`, `gateway.ts`, `demo.ts`
- `apps/server/src/groups/service.ts`
- `apps/server/src/app.ts`, `index.ts`
- Tests: `apps/server/src/approvals/rules.test.ts` (new, 25 tests incl. end-to-end approve-always → second request auto-runs), `apps/server/src/approvals/rules.routes.test.ts` (new, 15 tests), `gateway.test.ts` (+4 standing-rule tests), `groups.test.ts` (+1 removeGroupAi-revokes-group-rules test), small updates to `service.test.ts`/`routes.test.ts` for the `{ row, rule }` shape and `alwaysEligible` field

### Commands run and real results
- `pnpm install`: already up to date (834ms).
- `pnpm --filter @galena/server db:generate` (probe run): "No schema changes, nothing to migrate" — migration is complete.
- `pnpm format:check`: pass ("All matched files use Prettier code style!").
- `pnpm lint` (oxlint): pass, no warnings.
- `pnpm typecheck` (root): pass. (`pnpm --filter @galena/server typecheck` equivalent `tsc --noEmit`: pass.)
- `pnpm exec turbo test --force --filter=@galena/server`: 57 files passed, 5 skipped; 878 tests passed, 7 skipped, 0 failed (incl. untouched `authz-sweep.test.ts`: 5/5 pass, new routes answer 401 without a session).
- `pnpm build`: pass (2 tasks successful).
- Note: vitest default timeouts (5s test / 10s hook) flake under parallel PGlite load — I reproduced hook timeouts on the BASE commit too, so it is pre-existing, not caused by this task. The package `test` script uses `--testTimeout=30000 --hookTimeout=30000`; with those flags every touched file passes individually and the full turbo suite above is green.

### Problems, deviations from the spec, open questions
- Deviation (documented, tests cover it): the rule-use check in `gateway.ts request` runs after adapter lookup + AI-status/group reads but before the policy's args validation, not literally "after args validation and hash". Net effect matches the spec: invalid args on the auto-run path answer `denied invalid_args` (no card, no execution); valid args execute with the hash audited. A stopped AI is denied before the rule lookup.
- Spec sentence "The routes get an optional dependency `alwaysEligible?`" — implemented as specified on the approvals routes (and `app.ts`); the gateway instead reads `allowAlways`/`estimateCost` off the adapter registry directly (same source `buildAlwaysEligible` is built from).
- I renamed no audit action: `approval_rule.created` is written once per successful `approve_always` decision (not only when the row is new); idempotent repeat decisions are visible in the audit trail rather than inventing a new `already_exists` action name.
- Q for the lead: `GET /api/groups/:id/approval-rules` lists ALL of the group's rules (any AI) per "keep it simple: group owner/admin" — confirm that is the intended visibility (vs. only rules for AIs the caller owns).

### Blocked / needs a decision
- None. Live check steps come with T-0100 (web).

---

## Review (written by Claude)

**Verdict:**
