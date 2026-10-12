---
id: T-1260
title: "Audit (docs only): what 'delete my account' (7-day grace) and 'export my messages' must touch — every table with a user id, the ejabberd account + MAM archive + rosters + rooms owned, uploads/avatars, push rows, sessions, AIs owned; write docs/audit/account-deletion-plan.md with the exact delete order and a task split"
status: merged
milestone: M5
branch: task/T-1260-account-deletion-audit
model: auto
effort: default
depends_on: [T-1258]
estimate: 0.3 day
---

# T-1260: Plan account deletion and export

## Spec (written by Claude, do not edit)

### Why
This is item 12 of the Telegram parity plan (`docs/audit/telegram-parity-audit.md:272`): "delete account with 7-day grace, export my messages as JSON from MAM". Nothing exists yet (`:169-170`).
- **Deletion destroys data in several systems:** Postgres (53 migrations; 30 of them mention `user_id`, in `apps/server/drizzle/`), ejabberd (the XMPP account, its MAM archive, rosters, MUC rooms), files on disk or S3 (uploads, avatars), push devices, and Better Auth sessions.
- **So the lead wants a written plan before any code.** This task changes **no code**.

### What to do
1. **List every Postgres table** that holds a user id or a JID derived from one (read `apps/server/drizzle/*.sql` and `apps/server/src/db/rows.ts`). For each, give:
   - the column;
   - whether an FK with `ON DELETE CASCADE` from `user` already covers it;
   - what to do: cascade, explicit delete, anonymise (for example messages others still see), or keep.
2. **ejabberd:**
   - which admin commands delete the account and its archive: read `apps/server/src/xmpp/admin/client.ts` and `types.ts`, and cite the ejabberd docs for `unregister`, `delete_mam_messages` or `remove_mam_for_user`;
   - what happens to the other person's copy of a DM (it stays in their archive, as in Telegram);
   - rosters: remove the user from contacts' rosters (T-1233 already removes a contact both ways; cite it);
   - groups: the user leaves every group, and a group they own needs a decision. Recommend: make the oldest admin owner, or delete the group if alone, citing T-1187 and T-1243 code paths;
   - channels.
3. **Files:** uploads and avatars. Where they live (`apps/server/src/files/`, `apps/server/src/avatars/`), and which to delete (avatars yes; files shared in chats are a decision, so recommend one).
4. **AIs** the user owns (`apps/server/src/ais/`), agent tokens, integrations and approvals.
5. **The 7-day grace:**
   - the data model (for example `user_deletions(user_id, requested_at, delete_after)`);
   - what the account can do meanwhile (Telegram: sign in cancels it);
   - the job that runs the deletion (the server has scheduled work? Cite it, or propose one);
   - the audit entries (ids only).
6. **Export:**
   - the shape: JSON of my profile, contacts, and my messages from MAM (my own archive), paged;
   - size limits;
   - whether it's a direct download (a `GET` streaming JSON, offered from `apps/web/src/components/ProfileSettingsSection.tsx`) or a file built in the background;
   - the security rules: auth required, fresh session, rate limit.
7. **Write `docs/audit/account-deletion-plan.md`** with:
   - 1-6 above as tables with `file:line` evidence;
   - the exact delete order (what first, so nothing breaks halfway, and how a crash mid-way resumes);
   - the open decisions for Julio, each with a recommendation;
   - a split into 4-6 follow-up tasks (server request/cancel + grace table; the deletion job; web UI; mobile UI; export server + web), each with its Allowed files.
8. **No code, config or migration.**

### Read first
`AGENTS.md`, `docs/audit/telegram-parity-audit.md`, `apps/server/src/db/rows.ts`, `apps/server/drizzle/`, `apps/server/src/xmpp/admin/`, `apps/server/src/auth/`, `apps/server/src/contacts/`, `apps/server/src/groups/`, `apps/server/src/files/`, `apps/server/src/avatars/`, `apps/server/src/ais/` and `apps/server/src/push/store.ts`.

### Allowed files
`docs/audit/account-deletion-plan.md`, `work/T-1260-account-deletion-audit.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The doc exists, cites `file:line` for every claim, and ends with the task split and Julio's open decisions.

---

## Report (written by the worker when done)

### What I did
Wrote `docs/audit/account-deletion-plan.md` (docs only, no code, config or
migration). It covers: every Postgres table with a user id or a JID derived
from one, with its FK and `ON DELETE` behaviour and a recommended action; the
ejabberd commands; files; AIs; the 7-day grace model; the export shape; the
exact delete order with crash-resume; Julio's 12 open decisions (each with a
recommendation); and a split into 5 follow-up tasks with Allowed files.

Notable findings from reading the schema:
- `groups.created_by` and `topics.created_by` are `ON DELETE cascade`
  (`apps/server/drizzle/0003_shocking_boom_boom.sql:38`,
  `0018_lethal_warhawk.sql:37`), so a plain user delete would destroy groups and
  topics the user created but no longer owns. The plan repoints them first.
- `ais.provider_connection_id` is `ON DELETE restrict` against
  `provider_connections` (`0005_clean_frightful_four.sql:36`) while
  `provider_connections.owner` cascades (`0004:12`), so AIs must be deleted
  before the user row.
- `retired_handles.former_user_id` cascades (`0035:36`), which would drop the
  handle reservation.
- The ejabberd client has `unregisterUser` but **no MAM command**; deletion of
  the archive needs `remove_mam_for_user` added to
  `apps/server/src/xmpp/admin/client.ts` / `types.ts`. The peer's copy of a DM
  stays, because MAM is scoped per archive owner
  (`apps/server/src/search/archive-query.ts:65,128`).
- Message uploads live in the ejabberd container
  (`infra/ejabberd/ejabberd.yml:198-201`) with no admin command to delete them,
  so that step needs an infra/ops decision (open decision 7).

### Files changed
- `docs/audit/account-deletion-plan.md` (new)
- `work/T-1260-account-deletion-audit.md` (this report + front matter)

### Commands I ran (real results)
- `pnpm install` — done (1271 resolved, "Done in 12.6s").
- `pnpm gate` — `GATE PASS`. Summary lines:
  - `gate: 2 changed file(s) against main`
  - `PASS install (frozen) (1.1s)`
  - `PASS format (1.0s)`
  - `PASS lint (1.0s)`
  - `PASS typecheck (1.2s)`
  - `SKIP effect (no source files changed)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
- No single test files were run (docs-only change; nothing to test).

### Problems / deviations
- None against the spec. The spec said "cite the ejabberd docs for `unregister`,
  `delete_mam_messages` or `remove_mam_for_user`": the current ejabberd API
  reference names `remove_mam_for_user` and `remove_mam_for_user_with_peer`
  (there is no `delete_mam_messages`; `delete_old_mam_messages` deletes by age,
  not per user), so the plan cites `remove_mam_for_user` and `unregister`.
- The plan proposes `user_deletions` columns (`phase`, `started_at`,
  `last_error`) beyond the spec's example, to make the job claimable and
  resumable; flagged for the lead's review.

### Open questions
- The 12 decisions in §8 of the doc are for Julio; none block the plan itself.
  The upload-file deletion (decision 7) is the only one that cannot be done from
  the app server at all.

### Round 2 (pre-review fixes)
PREREVIEW.md raised 1 must-fix, 3 should-fix and 4 nits. Every must-fix and
should-fix was fixed, one commit each; the nits were left untouched (none fall
in a line changed for a finding). Docs only, so no tests were added: the
findings fix the plan, not code, and there is no behaviour to test.

- **Finding 1 (must-fix) — handle reservation must outlive the user delete.**
  §1b (`retired_handles`), the delete-order step 11 and decision 4 now say to
  drop `retired_handles_former_user_id_user_id_fk` in the T-A migration before
  the job relies on the reservation. Step 15's cascade no longer erases the
  reservation step 11 created, and a post-delete insert no longer violates the
  FK. Decision 4 also records why `ON DELETE set null` cannot work: the
  `retired_handles_owner_check` (`0035:29`) requires exactly one owner.
- **Finding 2 (should-fix) — step 9 is not idempotent.** Step 9 now reads
  `if (await userExists(localpart)) unregisterUser(localpart)`, matching
  `deleteAi` (`provisioning-xmpp.ts:126-132`). §2 gained a note that
  `unregisterUser` throws on any non-ok response
  (`admin/client.ts:112-118,141-145`), and the crash-resume list now says step 9
  is a no-op only via that guard.
- **Finding 3 (should-fix) — grace row cascade.** The `user_deletions.user_id`
  column no longer has `REFERENCES "user"(id) ON DELETE CASCADE`; the DDL and
  step 16 now say the row has no FK on purpose, survives step 15, and is deleted
  explicitly as the true last step, so the lease-reclaim resume keeps its key and
  `account.deleted` is still audited.
- **Finding 4 (should-fix) — inventory gaps.** §1 now lists
  `group_members.user_id` (cascade, §1a, `0003:37`), `sticker_packs.owner_id`
  (cascade decision, §1b, `0029:32`) and `avatars.owner_id` (polymorphic, no FK,
  §1d, `0037:1-11`).

Nits 5-8 were not fixed: each sits outside the lines changed for the findings
(they are all permitted as optional and AGENTS.md says not to touch nits outside
changed lines).

Disagreements: none.

Findings fixed: 1, 2, 3, 4. Tests added: none (docs-only).

`pnpm gate` (`GATE PASS`):
```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.7s)
PASS  lint  (0.9s)
PASS  typecheck  (0.9s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
```

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean after 1 auto round (4 nits).**
- **What the lead read:** `docs/audit/account-deletion-plan.md` (500 lines) has:
  - every table classified by FK behaviour (§1a-1d);
  - the ejabberd steps, including `remove_mam_for_user` and a `userExists`-guarded `unregister`;
  - files, AIs, the grace model and the export;
  - a 16-step idempotent delete order (AIs before the user row because of the restrict FK; references repointed before `DELETE FROM "user"`);
  - 12 open decisions with recommendations;
  - a 5-task split (T-A … T-E).
- **Next:** the decisions go to Julio in NOW.md. The lead may start T-A (request/cancel + grace table) on the recommendations, but holds T-B (the destructive job) until Julio confirms decisions 1-7.
