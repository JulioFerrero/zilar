# T-0124 Channels — Pre-review (HEAD 5567bde)

Covers `main...5567bde` (3 commits). Round 3 (5567bde) fixed prior findings 1, 2, 4, 5, 6, 8, 9 from the earlier pass; I re-verified each fix below and re-ran the Checks myself.

## Checks (re-run by me at 5567bde)

- `pnpm format:check`: PASS — "All matched files use Prettier code style!"
- `pnpm lint`: PASS (oxlint clean, exit 0)
- `pnpm typecheck`: PASS (10/10 turbo tasks)
- Server targeted (`groups`, `admin-client`, `topics`, `chats`, `invite-links`, `authz-sweep`): **FAIL — 88 failed / 36 passed**. Every sampled failure is `error: column "kind" does not exist` — schema.ts adds `groups.kind`/`description` but **no migration is committed**, and tests build the DB from committed migrations (`test-support.ts` → `runMigrations` → `drizzle/` folder).
- Server full suite: **FAIL — 108 failed / 1320 passed / 7 skipped (6 files failed, 76 passed)**. All 6 failing files (`groups`, `actions/gateway`, `agents/gateway`, `invite-links`, `tools/service`, `approvals/service`) fail only on the missing `kind` column (59× `Caused by: column "kind" ... does not exist` in the log; the 503-vs-201 assertion failures are downstream of the same cause). No other failure cause found in samples from every failing file.
- `authz-sweep`: PASS (not among failing files; sweep output shows new `GET /groups/:id/members` → 401 and `PUT .../role` → 401).
- Web full suite: PASS — 76 files, 832 passed.
- Web `Channels.test.tsx` alone: **FAIL — 1 failed / 8 passed** (flaky, see finding 1; passes in the full-suite run).
- `pnpm build`: PASS (2/2).

## Findings

1. `apps/web/src/components/Channels.test.tsx:126` — **must-fix (failing/flaky assertion)**. `expect(await screen.findByText('Releases'))` throws `Found multiple elements with the text: Releases` (chat-list span `text-[14px]` + header span `text-[15px]`). `findByText` resolves on first match but throws when both render in the same tick, so it passes in the full suite and fails standalone — timing-dependent. Concrete scenario: any CI run scheduling this file alone goes red. Fix: scope the query (`within` the list, or `findAllByText` + length assert).
   ```tsx
   expect(await screen.findByText('Releases')).toBeTruthy();
   ```
2. Missing migration — **must-fix (blocked on lead, per Report)**. `apps/server/src/db/schema.ts:100-104` adds `kind`/`description`; `git diff main...HEAD --name-only | grep -i drizzle` → none. Until the lead runs `db:generate` (expected 0030 after the T-0120 rebase), the entire server suite is red (108 failures) and no channel behaviour is verifiable by tests. The Report is upfront about this; confirming it is load-bearing, not theoretical.
3. `apps/server/src/groups/service.ts:651` + `routes.ts:138` — **should-fix (spec deviation needs lead sign-off)**. The spec says "the member list is visible to admins only", but `listMembersForViewer` now returns the admins slice (names + roles) to subscribers, and `ChannelPanel.tsx:91-96` fetches it for the Admins section. The worker's justification (who posts is public — every admin post carries its name) is reasonable, but it relaxes a literal spec rule silently. Either the spec wording or the Review must bless the slice explicitly.
   ```ts
   return { members: all.filter((member) => member.role !== 'member'), isAdmin };
   ```
4. Prior findings verified FIXED in 5567bde (spot-checked, no re-raise): XMPP affiliation moved out of the tx with `syncChannelVoice` reconcile on failure (`service.ts:536-561`); AI voice applied at add time via feed re-sync; role route same-404 for non-owners (`service.ts:514`); `ROLE_CHANGE_RATE_LIMIT_MAX = 30/hour` on the role route (`routes.ts:78-96,165`); race comment corrected (no longer claims self-healing); preview selects `{ title, kind }` only.
5. `docs/SERVER_CONFIG.md` — **nit (scope)**. Still outside the spec's Allowed files; the Report claims the lead allowed it in round 2. Needs one line of confirmation in the Review, then it can be forgotten.
6. Secrets / cross-user / tests-for-wrong-reason — checked, nothing found. `group.role_changed` detail is `{groupId, subjectUserId, from, to}` (ids + roles only); no `console`/secret logging in new code; no `any`/`ts-ignore`/disable comments in added lines; channel tests assert real outcomes (affiliation state, 409 codes, audit row, admins slice with subscriber id absent); the flaky-affiliation recovery test asserts row-committed + log + healed voice.

Scope: all changed files within Allowed files **except** `docs/SERVER_CONFIG.md` (finding 5). No mobile/dependency/ejabberd.yml/lockfile changes. No migration files committed.

Verdict: NOT READY — land the migration (server suite red without it), fix the flaky `findByText('Releases')` assertion, and bless the subscriber-visible admins slice in the Review.
