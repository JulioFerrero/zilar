---
id: T-0134
title: Server follow-ups from the invite-links, pins and roles reviews
status: review
milestone: M5
branch: task/T-0134-server-followups
model: meta/muse-spark-1.3-contributor
depends_on: [T-0114, T-0115, T-0116]
estimate: 1 day
---

# T-0134: Server follow-ups

## Spec (written by Claude, do not edit)

### Why
Server items the reviews recorded and did not block on, plus one item that only became possible after T-0116. Read `AGENTS.md` (test policy and security checklist) first. No schema change; if you think one is needed, stop and say so in the Report.

### Fixes
1. **Same user, two racing joins burn two uses** (`invite-links/service.ts` `joinByInviteLink`): the already-member check and the claim race, and the loser's insert is a no-op after the claim. Make the second request consume nothing: claim and insert in one transaction, or refund when the insert did nothing (`onConflictDoNothing` returned no row). Test with two concurrent joins by the same user: `uses` ends at 1.
2. **Per-IP join limiter behind a proxy** (`invite-links/routes.ts` `socketAddress`): behind Caddy every user shares the proxy IP, so the 60/hour budget is global. Add an optional config `TRUSTED_PROXY_HOPS` (integer 0 to 5, default 0, validated with zod, documented in `docs/SERVER_CONFIG.md`, added to `deploy/.env.example` as a comment). With N > 0 the client IP is the Nth address from the RIGHT of `x-forwarded-for` (an attacker controls the left side); with 0 headers are ignored as today. Use it only for the join limiter for now. Tests for 0, 1 and 2 hops and for a forged left-most entry.
3. **Pin "not found" messages** (`pins/service.ts` `unpinMessage`): answer the same message and body as an invisible chat ("Chat not found") so pin ids cannot be told apart. Update the test.
4. **Search with roles** (`search/**` `allowedArchives`): after T-0116 a role holder can see a private topic room through a role; the allowed archive set must include those rooms and exclude a user's rooms after they lose the role or leave the group. Tests with a role holder, a non-holder and a leaver.
5. **`GET /api/join/:token` preview** is not rate limited: add a generous per-user limit (120 per hour) so tokens cannot be probed at full speed. Test.
6. **ApprovalCard N+1**: the approvals list payload should carry each approval's topic approver names (ids resolved server-side, only for topics the caller can see) so the web card does not call `getTopic` per card. Add the field to the list response and its zod schema; the web change is out of scope (note it in the Report for a follow-up).

### Read first
`AGENTS.md`, the Reviews in `work/T-0115-invite-links.md`, `work/T-0114-pinned-messages.md`, `work/T-0116-group-roles.md`, `work/T-0117-message-search.md`; `apps/server/src/{invite-links,pins,roles,search,approvals}/`.

### Allowed files
`apps/server/src/{invite-links,pins,search,approvals,roles,config.ts,config.test.ts,app.ts}`, `authz-sweep.test.ts`, `docs/SERVER_CONFIG.md`, `deploy/.env.example` (comment only), `work/T-0134-server-followups.md`. Not allowed: schema, web, mobile, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/server test --maxWorkers=2
pnpm build
```
(Affected tests while working; the full server suite once at the end.)

### Acceptance criteria
- [ ] Each of fixes 1 to 6 has a test that fails without it.
- [ ] Server suite exits 0.

### Out of scope
Schema changes, UI, new features.

---

## Report (written by the worker when done)

### What I did
- Fix 1 (same-user racing joins): `joinByInviteLink` now runs the membership re-check, the atomic claim and the insert in ONE transaction. The loser (in-tx re-check sees the committed row, or on Postgres both claimed and `onConflictDoNothing` returns no row via the unique index) answers 200 `alreadyMember: true` and consumes nothing — its own claim rolls back. The old `refundLinkUse` is gone (a 503 rolls back automatically); post-commit topic sync + invitation + audit unchanged. The test stages winner-then-loser (true both-claimed interleave is impossible on PGlite — parking inside the open tx deadlocks the second join's queries) and pins the loser shape (`alreadyMember: true` + `uses` 1); against the pre-fix code the loser's body is `alreadyMember: false` (no loser path existed) and `uses` is scheduling-dependent (1 or 2).
- Fix 2 (proxy IP): new `TRUSTED_PROXY_HOPS` env (zod `z.coerce.number().int().min(0).max(5).default(0)`), documented in `docs/SERVER_CONFIG.md`, comment in `deploy/.env.example`. `clientIpFor(hops)` resolves the Nth address from the RIGHT of `x-forwarded-for` (`trustedClientIp`, exported for tests); 0 hops = socket address as before. Used only by the join limiter. Test seam extended (`trustedProxyHops`, `joinLimiters.preview`).
- Fix 3 (pin 404): `unpinMessage` missing-pin path now throws `toMissingChat()` — byte-identical code/message to the invisible-chat 404 (`not_found`/`Chat not found`). Test asserts identical bodies.
- Fix 4 (search with roles): no code change needed — `allowedArchives` already reads `visibleTopics`, which includes role-held rooms. Added the spec's test: role holder finds the private room (unfiltered + `chat` filter), non-holder gets nothing + 404 on the filter, and the holder finds nothing + 404 after leaving the group — plus a public-room control the outsider keeps finding throughout, proving scoping rather than blindness. Sensitivity-checked by temporarily disabling the role block in `visibleTopics` (test failed, then restored byte-identical).
- Fix 5 (preview rate limit): `GET /api/join/:token` now has a 120/hour per-user limiter (`JOIN_PREVIEW_RATE_LIMIT_*`), checked after the session, before the token parse. Test with a budget of 3 + window advance.
- Fix 6 (ApprovalCard N+1): `PublicApproval` gains `approverNames: string[]` (sorted holder names, `[]` for personal chats / no approver role / departed holders excluded via a group-membership join). Resolved in ONE batched query per list (`approverNamesForTopics`, keyed by topic) and reused for single + decision reads. One role may approve several topics: names fan out to every topic sharing the role (tested). Only topics the viewer can see ever reach the list; role membership is not secret. Web change out of scope: `apps/web/src/lib/api.ts` `publicApprovalSchema` still needs the optional `approverNames` field (follow-up; the web parses with zod, so an unknown key is fine until then — actually `z.object` strips unknown keys by default, so old web keeps working).
- Each fix has a test that fails without it (verified by stashing the fix and re-running: fix 1 loser body `alreadyMember: false` vs `true`; fix 5 4th preview 200 vs 429; fix 6 `undefined` vs names, and `[]` vs names without fan-out on a shared role; fix 3 new assertions on the unified body; fix 2 new unit + integration cases against the old socket-only path; fix 4 sensitivity check described above).

### Files changed
- `apps/server/src/invite-links/service.ts` (single-tx join, preview limit constants, refund removed)
- `apps/server/src/invite-links/routes.ts` (`clientIpFor`/`trustedClientIp`, preview limiter, seam fields)
- `apps/server/src/invite-links/invite-links.test.ts` (+5 tests: same-user race, hops unit cases, 0-vs-1-hop limiter, 2-hop limiter, preview limiter)
- `apps/server/src/pins/service.ts` (unified 404), `pins/pins.test.ts` (identical-body assertions)
- `apps/server/src/search/search.test.ts` (+1 role-holder/non-holder/leaver test; no source change)
- `apps/server/src/approvals/service.ts` (`approverNames`, `approverNamesForTopics`, wired into list/get), `approvals/routes.ts` (decision path), `approvals/routes.test.ts` (key-shape + names test incl. departed-holder exclusion and decision response)
- `apps/server/src/config.ts` (+ `TRUSTED_PROXY_HOPS`), `config.test.ts` (default/explicit/reject cases; `toEqual` bodies updated)
- `docs/SERVER_CONFIG.md` (row + join paragraph), `deploy/.env.example` (comment only)
- `work/T-0134-server-followups.md` (this report + status)

### Commands run and real results
- `pnpm install`: pass (~13 s)
- `pnpm format:check`: pass (after `prettier --write` on my 12 touched files; `.env.example` has no parser, skipped)
- `pnpm lint` (oxlint): pass, clean
- `pnpm typecheck`: 10/10 pass
- Affected suites while working: pins 10 + config 44 + approvals/service 100 (3 files, one run); approvals routes/rules 72; search + sweep + app 30; roles + topics + groups 85; invite-links 20/20 full file (~175 s); each new test also run solo
- Full `pnpm --filter @galena/server test --maxWorkers=2`: 82 files passed, 5 skipped; 1427 passed, 7 skipped, 0 failed (~463 s), EXIT 0
- `pnpm build --force`: 2/2 pass (~41 s)
- `grep` for `any|@ts-ignore|disable` in new/changed lines: no hits (two false positives: the words "forged"/"rate_limited" context and a comment)

### Problems, deviations from the spec, open questions
- No schema change (none needed). No new dependencies, no `any`, no disable comments.
- Fix 1 subtlety: on Postgres two same-user txs can both pass the in-tx re-check (neither committed); both claim, then the loser's `onConflictDoNothing` insert returns no row → `alreadyMember`, claim rolls back. Deterministic on PGlite via the tx-start gate test; on Postgres the unique index is the backstop.
- Fix 4: genuinely no source change — the T-0116 `visibleTopics` role block already feeds `allowedArchives`. The test pins the behavior so a regression fails loudly.
- Fix 6 follow-up for the lead: add optional `approverNames: z.array(z.string()).default([])` to web `publicApprovalSchema` and use it in `ApprovalCard` instead of `getTopic` (web is outside my Allowed files).
- Preview limiter counts before token validation, so invalid-token probes also consume the budget — intended (that is the probing being limited).

### Round 2 (pre-review fixes 1–4, 6)
- Finding 1 (MUST): rewrote the `joinByInviteLink` comment to state the real guarantees — same-user loser via in-tx re-check or the unique-index no-row backstop (200 `alreadyMember`, own claim rolls back); two strangers on a 1-use link serialize on the conditional claim UPDATE (loser gets 404 `invalid_link`, never `alreadyMember`); room failure after the claim rolls back to a 503 that burns nothing. No `SELECT ... FOR UPDATE`/advisory lock is claimed anymore.
- Finding 2 (SHOULD): re-scoped the same-user test to what PGlite can stage (winner-then-loser; a true both-claimed interleave deadlocks on PGlite's single connection — verified empirically) and strengthened it with the loser-shape assertion (`{alreadyMember: true}` + `uses` 1, deterministic 3/3). Against the pre-fix code the loser's body is `{alreadyMember: false}` (no loser path existed); `uses` there is scheduling-dependent, which is why the shape assertion is the discriminator.
- Finding 3 (SHOULD): `roleToTopic` → `roleToTopics` (`roleId → topicId[]`); holder names fan out to every topic sharing the approver role. New test with two topics sharing one role carries names on both cards; fails without fan-out (`[]` on the second).
- Finding 4 (SHOULD): search role test gains a public-General control the outsider keeps finding after the holder assertions and after the leave (holder sees both, outsider only the control).
- Finding 6 (NIT): deleted the duplicated comment in `pins.test.ts`.
- Finding 5 needed no change (ordering confirmed: session → limit → token parse).
- Round-2 verification: pins + config 54 passed; approvals routes + service 66 passed; search + invite-links 40 passed; full server suite 1427 passed, 1 failed in `sandbox/run-tool.test.ts` (`does not count fetch wait time against cpuMs` — timing-sensitive, untouched by this task, passes in isolation 1/1); `format:check` clean for all owned files (repo-wide flag is only the untracked `PREREVIEW.md`, not mine); `lint` clean; `typecheck` 10/10.

### Blocked / needs a decision
- None.

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
