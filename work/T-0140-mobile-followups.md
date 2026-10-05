---
id: T-0140
title: Mobile: deferred review follow-ups (invite links, roles, search)
status: merged
milestone: M5
branch: task/T-0140-mobile-followups
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: [T-0136, T-0137, T-0138]
estimate: 1 day
---

# T-0140: Mobile: deferred review follow-ups

## Spec (written by Claude, do not edit)

### Why
Three mobile tasks merged with small deferred review items (see the Review sections of T-0136, T-0137, T-0138). Clear them in one task. Read `AGENTS.md` first.

### What to build
1. Invite links (T-0136): the mock `preview`/`join` must derive `alreadyMember` from the mock store state instead of hardcoding `true`, so the real Join path is exercised in mock mode; re-point the two partly vacuous render tests ("same neutral message", "never carries the token") so they fail if the component leaks the token itself (feed it a raw error and assert the rendered text); a nameless signed-in user who pastes a junk token must not be sent to a route that does not exist: keep the raw param through the name gate (`/welcome/name?from=...`) or show the invalid-link state first.
2. Roles (T-0137): the first roles load failure on the group screen must use `describeRolesError(error, 'load')` instead of the hardcoded generic line; test it.
3. Search (T-0138): the jump-scroll retry timers must re-resolve the target message index on every retry (a new message arriving within 400 ms must not scroll to a stale row); `loadMore` must keep its AbortController and abort the superseded page request. Tests for both.
4. Do not change server, web, packages or dependencies.

### Read first
`AGENTS.md`, the Report and Review sections of `work/T-0136-mobile-invite-links.md`, `work/T-0137-mobile-roles-admin.md`, `work/T-0138-mobile-search.md`, then the files they list.

### Allowed files
`apps/mobile/**`, `work/T-0140-mobile-followups.md`. Not allowed: server, web, packages, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/mobile test --maxWorkers=2 <touched test files and their neighbours>
```
Do NOT start simulators, Metro, or `expo run`.

## Report (written by the worker)

### What I did
1. **Invite links (T-0136 follow-ups)**:
   - Mock `preview`/`join` now derive `alreadyMember` from mock-store state instead of hardcoding `true`: `createMockInviteLinksStore` takes an `isMember(groupId)` membership, wired in `chat-store.ts` to the store's group detail (viewer in `g-devteam` detail = member). A stranger's link previews `alreadyMember: false` with no `groupId` (like the server) and the join consumes a use and reports `alreadyMember: false`, so the real Join POST path is exercised in mock mode. Members still get the no-use-consumed fast path; a store-local `joined` set tracks mock joins (the seeded detail snapshots never change). Server semantics mirrored from `apps/server/src/invite-links/service.ts` (read only).
   - Token-leak tests re-pointed: extracted the route's inline raw-error mapping into tested `joinPreviewFailure(error)` / `joinPressFailure(error, preview)` helpers in `join-link.tsx` (status/code only, undefined-safe). Tests feed RAW token-bearing errors (`request to /api/join/<token> failed`) and assert neither the view object nor the rendered text contains the token; the invalid-render test maps from the raw error first.
   - Nameless/junk-token gate: the join route keeps the RAW param (`/join/<raw>`) through the login redirect and the name gate (`NameGate` takes `raw`, not the parsed token), so a junk token still matches `[token]` and shows the invalid-link state. A missing param falls back to `/` (not `/join`, which matches no route). A missing token is now the neutral invalid state, not the offline retry (the request was never worth making).
2. **Roles (T-0137 follow-up)**: the group screen's mount load now uses `describeRolesError(error, 'load')` instead of the hardcoded generic line — a first-load 404 reads as the refreshable gone line. Test: real-store `refreshGroupRoles` rejection for 404/generic mapped through `describeRolesError(..., 'load')` (the unit matrix in `roles.test.ts` already covers the helper itself).
3. **Search (T-0138 follow-ups)**:
   - Jump scroll: extracted `startJumpScroll` (`components/chat/jump-scroll.ts`, UI-free) — each attempt (initial + 80/200/400 ms retries) re-resolves the index via `findIndex`, so a message arriving within 400 ms no longer scrolls to a stale row. `MessageList` wires it thinly. Tests with a deferred clock: index shifts between retries are followed; unloaded target scrolls nothing and keeps the target; disappearing target skips; cancel clears timers.
   - `loadMore` keeps its AbortController (`pageController`): a second call while a page is in flight aborts the superseded request; its late result is dropped by id + abort; `dispose`/fresh-query abort it too; `paging` clears only for the current request. Test: two back-to-back `loadMore`s abort the first signal and land only the second page.
4. No server, web, packages or dependency changes.

### Files changed
- `apps/mobile/src/mock/invite-links.ts` (membership param, member-aware preview/join, joined-set, no-groupId-for-strangers), `apps/mobile/src/store/chat-store.ts` (membership wiring).
- `apps/mobile/src/components/chat/join-link.tsx` (`joinPreviewFailure`, `joinPressFailure`), `apps/mobile/src/app/join/[token].tsx` (raw param through gates, uses the helpers), `apps/mobile/src/components/chat/join-link.test.tsx` (re-pointed token tests + mapping matrix).
- `apps/mobile/src/app/group/[id].tsx` (first load via `describeRolesError`), `apps/mobile/src/store/real-store.roles.test.ts` (first-load mapping test).
- `apps/mobile/src/components/chat/jump-scroll.ts` (new) + `.test.ts` (new), `apps/mobile/src/components/chat/message-list.tsx` (wiring), `apps/mobile/src/components/chat/message-search.ts` (page controller + abort), `apps/mobile/src/components/chat/use-message-search.test.ts` (abort test), `apps/mobile/src/store/invite-links.test.ts` (member/stranger + exhaustion-via-stranger tests).

### Commands run and real results
- `pnpm install`: pass (~10s).
- Touched suites: `join-link` + `jump-scroll` + `use-message-search` + `invite-links` + `real-store.roles`: 5 files, 59 passed.
- Neighbours: `real-store.invite-links` + `real-store` + `chat-store` + `message-search` + `invite-links-sheet` + `mock/search` + `invite-links-api`: 7 files, 130 passed. Roles neighbours (`roles-mock`, `roles`, `group-roles-sheet`, `topic-sheets-roles`): 4 files, 36 passed.
- `pnpm format:check`: pass ("All matched files use Prettier code style!").
- `pnpm lint` (oxlint): pass.
- `pnpm typecheck` (turbo, 10 tasks): pass.
- No `any`/`@ts-ignore`/disable comments in touched non-test source (grep: only benign "message"/"many" prose matches).
- Not run: full mobile suite (lead runs once per batch), simulators/Metro/`expo run` (forbidden).

### Problems, deviations, open questions
- The pre-existing one-use-exhaustion test created its link in `g-devteam` where the viewer is a member; under correct server semantics (member joins consume no use) it could never exhaust. Re-pointed it at `g-neighbors` — this is the intended behavior change, not just a test fix.
- `joinLinkViewFor` keeps its `joinError: string` pass-through (used for the fixed offline-retry line); token safety now lives in `joinPressFailure`, which never forwards raw text. The route no longer maps errors inline.
- Security checklist: tokens travel only in the authorization header / request path the server expects; no new logging; errors carry status/code only; no new routes; mock changes are in-memory only.
- Still needs a human look (no simulator): join flow for a stranger link in mock mode, nameless-gate return with a junk token on device, jump-scroll centering with real image settling, aborted page requests against a real server.

## Review (written by Claude)

**Verdict:** approved, merged. Mobile only, one round.

### Findings
- Verified in the packet: mock invite membership derived from store state, token-leak tests now feed raw token-bearing errors (with a sanity assert that the raw text does contain the token), junk-token gate keeps the route valid, group-screen first roles load uses `describeRolesError`, `loadMore` aborts the superseded page and drops late results.
- Deferred should-fix: the roles-load test goes through `describeRolesError` itself, so reverting the wiring in `group/[id].tsx` would stay green; needs a screen-level test.
- Deferred nits: jump-scroll retries are cancelled by the synchronous `clearJumpTarget` (pre-existing pattern; check on a device); duplicate status/code extraction in `join-link.tsx`; `joinLinkViewFor` still accepts a free-form `joinError` string.

### Follow-ups
- Screen-level test for the group roles load error; a device check of search jump-scroll.
