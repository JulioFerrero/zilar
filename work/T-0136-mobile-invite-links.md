---
id: T-0136
title: Mobile: group invite links (create, manage, join)
status: planned
milestone: M5
branch: task/T-0136-mobile-invite-links
model: meta/muse-spark-1.3-contributor
depends_on: [T-0112, T-0115]
estimate: 2 days
---

# T-0136: Mobile: group invite links (create, manage, join)

## Spec (written by Claude, do not edit)

### Why
Web can create and revoke group invite links and join by link (T-0115). Mobile can do neither. The server API exists. Mobile is the smaller share of the work (about 20%), so keep it small and match how the mobile app already does lists, sheets, stores and its mock (`EXPO_PUBLIC_GALENA_MOCK`). Read `AGENTS.md` first, including the security checklist. Nothing here can be run in a simulator by the worker, so tests and typecheck carry the proof; say in the Report what still needs a human look.

### What to build
1. **Manage links** (group owner/admin only, same rule as web): from the group screen, an "Invite links" screen or sheet listing active links (label, uses, limit, expiry) with create (optional label, max uses, expiry choices as on web) and revoke. The full link is shown once, right after creation, with Copy and the system Share sheet; it is never stored, logged or shown again (only the token hash lives on the server).
2. **Join by link**: opening `galena://join/<token>` or the web URL shape `/join/<token>` (universal link config only if it needs no new dependency and no Apple account; otherwise just the custom scheme) shows a preview (group name, member count, from `GET /api/join/:token`) with Join and Cancel; Join calls `POST /api/join/:token` and opens the group. Also let people paste a link into an "Join with a link" entry in the new-chat menu. Signed-out users go through the existing sign-in and return to the join screen.
3. **Errors**: invalid, expired, revoked and full links all show the same neutral "This link does not work" message (the server answers them the same); rate-limit answers show a friendly retry text.
4. Tokens must never reach logs, error text, analytics or route params logged by the router beyond what the screen needs; strip them from any error you display.
5. Mock mode covers create, list, revoke, preview and join.

### Read first
`AGENTS.md`, `work/T-0115-invite-links.md` (Spec, Report, Review), `apps/server/src/invite-links/routes.ts`, the web client in `apps/web/src/lib/api.ts` (`invite-links` section) and its dialog for behaviour, `apps/mobile/src/app/invite/[code].tsx` (an existing but different invite), `apps/mobile/src/app/group/[id].tsx`.

### Allowed files
`apps/mobile/**`, `packages/chat-core/src/**` only if a shared type must change (say so in the Report), `work/T-0136-mobile-invite-links.md`. Not allowed: server, web, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @galena/mobile test --maxWorkers=2
```
(Affected tests while working; the full mobile suite once at the end. Do NOT start simulators, Metro, or `expo run`; Julio's simulators are off limits.)

### Acceptance criteria
- [ ] Create, list, revoke and join work in the store/API layer with tests (zod-validated responses).
- [ ] The token is shown only right after creation and never appears in any error or log string (test that).
- [ ] Preview and join screens have render tests; all failure kinds show the same message.
- [ ] Mock mode covers the flow.

### Out of scope
Web changes, server changes, QR codes, native universal-link setup that needs an Apple account.

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
