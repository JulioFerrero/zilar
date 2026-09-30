---
id: T-0133
title: Web follow-ups from the topics, invite-links and pins reviews
status: review
milestone: M5
branch: task/T-0133-web-followups
model: meta/muse-spark-1.3-contributor
depends_on: [T-0111, T-0113, T-0114, T-0115, T-0130]
estimate: 1 day
---

# T-0133: Web follow-ups

## Spec (written by Claude, do not edit)

### Why
Small should-fix and nit items the reviews recorded and deliberately did not block on. Fix exactly these in `apps/web`, each with a test that fails without the fix. Read `AGENTS.md` (test policy and security checklist) first.

### Fixes
1. `TopicPanel.leave()` swallows every error and always navigates away. On a non-404 error (network, 403) stay, keep the panel open and show the inline error; only a 404 (the topic is gone) navigates away.
2. `realStore` `quietArchiveIds`: clear the id when the self-archive finishes even if General is absent from the refreshed list (the `else` branch that navigates to `/` leaks the id).
3. `TopicPanel` `addMember` and `addAi` call the endpoint and then the store action, which sends the same request again (second error swallowed). Use one call, like `removeMember` now does. Test with a non-idempotent mock (second call would 409).
4. Kebab "Archive topic" failure: the `actionError` sits on a `hidden` element, so the user sees nothing. Show it (inline near the kebab or a visible alert).
5. `refreshTopicRow`: if a generation bump aborts the refresh silently, it must not read the stale list as "topic alive"; throw or retry once.
6. `InviteLinksSection`: `revokingId` is never cleared, so a failed revoke leaves the button stuck on "Revoking..."; clear it and show the error.
7. Mock `POST /join` never answers 409 `group_full` or 429, and mock create ignores the upper bounds (`expiresInHours` 8760, `maxUses` 10000); make the mock match the server so the `full` state is reachable in mock mode. Add a render test for it.
8. Mock search index does not cover topic threads; add them so search finds messages inside mock topics.
9. `scripts/screenshots.ts`: validate the shot table's `setup` names with a zod enum so a typo fails before the browser starts.

### Read first
`AGENTS.md`, the Review sections of `work/T-0130-topics-web-fixes.md`, `work/T-0115-invite-links.md`, `work/T-0114-pinned-messages.md`, `work/T-0111-topics-web.md`, `work/T-0131-screenshots-user-docs.md`.

### Allowed files
`apps/web/**`, `scripts/screenshots.ts`, `work/T-0133-web-followups.md`. Not allowed: server, mobile, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/web test --maxWorkers=2
pnpm build
```
(Run affected tests while working; the full web suite once at the end.)

### Acceptance criteria
- [ ] Each of fixes 1 to 9 has a test that fails without it.
- [ ] Web suite exits 0 with no unhandled errors.

### Out of scope
Anything not listed; no new features.

---

## Report (written by the worker when done)

### What I did
- Fix 1 (`TopicPanel.leave()` swallowed everything): `leave()` now navigates away only on success or on 404 (last seat → archived, topic gone); any other failure (403, network) rethrows into the inline error and keeps the panel open. Tests: 403 stays + inline error (fails on old code); 404 navigates with no alert.
- Fix 2 (`quietArchiveIds` leak): the quiet mark is now consumed while resolving ANY stranded open chat — moved the delete out of the General-present branch. This also covers the real leak path I found while testing: `applyTopicRow` drops the row at patch time, so `was` is undefined on the next refresh and the old inner-branch delete never ran (verified: the companion test fails on old code).
- Fix 3 (`addMember`/`addAi` double write): panel now calls only the store action (ONE POST), like `removeMember`; removed the now-unused direct endpoint imports. Tests record POSTs with a non-idempotent stub (second POST 409s): exactly 1 POST, picker closes, member/AI appears, no alert. All fail on old code.
- Fix 4 (kebab archive failure invisible): the `actionError` alert is now a visible popover under the header (was `hidden`) with the header as its anchor (`relative`). Test: failed PATCH → alert text visible, no `hidden` class, row survives, view stays. Fails on old code.
- Fix 5 (`refreshTopicRow` generation race): `refreshChatsOrThrow` now throws `stale_refresh` when a `start()`/`stop()` bumped the generation mid-refresh, instead of merging stale state and resolving "alive". Test: gated fetch + `stop()` mid-flight → recheck rejects `/superseded/`, row untouched. Fails on old code.
- Fix 6 (`revokingId` never cleared): `InviteLinksSection.revoke` clears the busy mark when the parent's revoke settles (success or failure); the parent's error prop already renders the message. Test: failed DELETE → error shown, button back to "Revoke", no "Revoking…". Fails on old code.
- Fix 7 (mock join/create fidelity): mock create 400s `invalid_request` outside 1..8760h / 1..10000 uses (server bounds; edge values still 201); mock join POST counts per-link attempts (reset with `resetMockApi`) → 429 `rate_limited` past 20, and 409 `group_full` at the 50-member cap without consuming a use (server order: limiters → cap → claim). Tests: bounds, 429, 409 incl. uses-stay-0, plus a mock-mode JoinPage render test reaching the `full` card through the real mock layer (temp 50-member group, cleaned up). All fail on old code.
- Fix 8 (mock search covers topic threads): the index now spreads `mockTopicMessages()` over `mockMessages` (General's legacy `c-devteam` thread untouched — topic chats have their own ids). Test: `checkout` finds the `c-devteam-bug` hit; chat filter narrows to it. Fails on old code.
- Fix 9 (screenshot setup enum): extracted the shot table into side-effect-free `scripts/shots.ts` (`SHOT_SETUPS`, `parseShots` with a zod enum, `shotTable(zod)` with zod injected so the file typechecks under both `scripts/` and `@galena/web` tsconfigs); `screenshots.ts` now imports it. Test `apps/web/src/shots.test.ts`: table parses (15 shots), a typo'd setup throws, setups match the runner. Typo test fails with a string schema (verified by temporary revert).
- Fail-without verification: each fix's discriminating test was run against the pre-fix code (via `git stash` of the source file, or temporary revert for fix 9) and fails there.

### Files changed
- `apps/web/src/components/TopicPanel.tsx`: fix 1 (leave 404-only navigation), fix 3 (single-call addMember/addAi, unused imports removed).
- `apps/web/src/store/realStore.ts`: fix 2 (consume quiet mark for any stranded resolution), fix 5 (`stale_refresh` throw on superseded refresh).
- `apps/web/src/components/ChatHeader.tsx`: fix 4 (visible archive-failure alert + `relative` anchor).
- `apps/web/src/components/InviteLinksSection.tsx`: fix 6 (clear `revokingId` on settle).
- `apps/web/src/mock/api.ts`: fix 7 (`validInviteLinkOptions` 400s, per-link `joinAttempts` 429, 50-member `group_full`), fix 8 (topic threads in search index); new `joinAttempts` state (reset with the rest).
- `scripts/shots.ts` (new): shot table + zod-enum validation, no imports/side effects.
- `scripts/screenshots.ts`: imports the table from `./shots.ts`, injects zod.
- Tests: `TopicPanel.test.tsx` (+4: leave 403/404, addMember/addAi single-call; shared opener hoisted), `realStore.topics.test.tsx` (+3: no-General quiet consumption, leaked-mark companion, superseded re-check), `TopicsMockE2E.test.tsx` (+1: visible kebab-archive error), `InviteLinksSection.test.tsx` (+1: failed revoke unsticks), `mock/api.invite-links.test.ts` (+3: bounds, 429, 409), `JoinPage.test.tsx` (+1: mock-mode `full` card), `mock/api.test.ts` (+1: topic-thread search), `shots.test.ts` (new, +3).
- `work/T-0133-web-followups.md`: this Report; status → review.

### Commands run and real results
- `pnpm install`: pass (8.1s).
- `pnpm format:check`: pass ("All matched files use Prettier code style!") after `prettier --write` on touched files.
- `pnpm lint`: pass (oxlint clean).
- `pnpm typecheck`: pass (turbo 10/10). Note: pulling `scripts/shots.ts` into the web program (via the test import) initially failed web typecheck (`node:` modules, zod path mapping); solved with zero-import DI design (zod injected) rather than tsconfig edits.
- `npx tsc --noEmit -p scripts/tsconfig.json`: pass.
- `pnpm --filter @galena/web test --maxWorkers=2` (full suite, once at end): 75 files passed, 818 passed, no unhandled errors.
- `pnpm build`: pass (2/2 turbo tasks).
- Scoped runs while working (all `--maxWorkers=2`): TopicPanel 15 passed; realStore.topics 17 passed; invite-links mock + JoinPage + InviteLinksSection + mock api 55+8+5+41 pass per file; shots 3 passed.
- Fail-without runs: TopicPanel source stashed → 3 fail (leave-403, addMember, addAi); realStore stashed → 2 fail (leaked-mark companion, superseded re-check); ChatHeader stashed → 1 fail (visible archive error); InviteLinksSection stashed → 1 fail (revoke unstick); mock api stashed → 4 fail (bounds, 429, 409, topic search + JoinPage full card); shots enum temporarily loosened → typo test fails. All restored after.

### Problems, deviations from the spec, open questions
- Fix 7's 429: the mock counts per link per page load (the mock has one user and no clock/IP seam); the budget number 20 mirrors the server's per-user hourly budget. The JoinPage has no rate-limited UI state (server 429 surfaces as the generic "Could not join" error), so no render test for 429 — only the layer test.
- Fix 7's `full` render test mutates the shared `mockGroupDetails` module const (adds/removes a temp 50-member group); cleaned up in `afterEach` and in a `finally` in the layer test. No other test touches that key.
- Fix 9 slightly restructured `scripts/screenshots.ts` (table moved to `shots.ts`); behavior identical — `shotTable()` still runs before the browser starts, now with the enum. The screenshot script itself was not re-run (no Chromium run; table data unchanged, 15 shots same names).
- Security checklist: no secrets/tokens in logs or errors (mock tokens stay in-memory; join fixes add only codes); no new routes; the mock 429/409 mirror server codes; audit untouched. Deletes/updates scoping N/A (client-side task).
- No live browser check was possible: flows proven by mock-mode render tests (join-full card, kebab archive error, panel leave/add paths) and store unit tests.

### Blocked / needs a decision
- None.

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
