---
id: T-0140
title: Mobile: deferred review follow-ups (invite links, roles, search)
status: todo
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
pnpm --filter @galena/mobile test --maxWorkers=2 <touched test files and their neighbours>
```
Do NOT start simulators, Metro, or `expo run`.

## Report (written by the worker)

## Review (written by Claude)
