---
id: T-0133
title: Web follow-ups from the topics, invite-links and pins reviews
status: planned
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
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
