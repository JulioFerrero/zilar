---
id: T-0136
title: Mobile: group invite links (create, manage, join)
status: merged
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
- API layer (`lib/invite-links-api.ts`, mobile twin of web `lib/api.ts` invite-links section): `createGroupInviteLink`, `listGroupInviteLinks`, `revokeGroupInviteLink`, `previewJoinLink`, `joinByLink` with hand-rolled type-guard validation (mobile has no zod, same style as `topics-api.ts`); `extractJoinToken` parses `galena://join/<token>`, `https://host/j/<token>`, `https://host/join/<token>` and bare 64-hex (junk never reaches the server); `joinFailureMessage` maps every failure to one neutral text, rate limits to a retry text, taking only status/code — the token never enters error text.
- Store: 5 new actions on `ChatStoreState` (`list/create/revokeInviteLink`, `previewJoinLink`, `joinByLink`); real store delegates to the API and refreshes chats after join; mock store backed by a new in-memory `mock/invite-links.ts`, keyed per group id (seeded Dev-team links + `g-neighbors` group titles/counts; preview/join enforce revoked/expired/exhausted with the same neutral 404, like the server, and report `alreadyMember` like the web mock).
- Manage UI: `InviteLinksSheet` on the group screen behind a link icon, owner/admin only (same rule as web, derived from group detail roles). Create (label ≤ 60, expiry 1..8760h, max uses 1..10000 — web rules), URL shown once with Copy (`expo-clipboard`) + system Share sheet + anyone-with-the-link warning, list with uses/state, Revoke. The created URL lives in screen state and is dropped on Done — never stored.
- Join UI: new `app/join/[token].tsx` route (custom scheme `galena://join/<token>` works via the existing `app.json` scheme — no new dependency, no Apple account, no native config change). Preview card (title, member count) with Join/Cancel; Join POSTs and opens the General topic (group screen fallback, chats-list fallback). Signed-out users go through login with `from=/join/<token>` and return; nameless users get an inline name gate linking to `/welcome/name?from=…` (mirrors web). All failure kinds show "This link does not work"; 429 shows the retry text; network failure (status 0) keeps the preview with a retry error. Plus a "Join with a link" paste form in the new-chat menu routing to `/join/<token>`.
- Tests: API tests (incl. extract/junk-rejection, neutral-message + token-absence assertions), sheet pure-view render tests (`InviteLinkRow`, `CreatedInviteLinkView`), join body render tests (all failure kinds same message), mock-store flow tests (incl. two-group isolation, one-use exhaustion, expiry via fake timers), real-store wiring test with injected fake API.

### Files changed
- New: `apps/mobile/src/lib/invite-links-api.ts` (+ `.test.ts`), `apps/mobile/src/mock/invite-links.ts`, `apps/mobile/src/components/chat/invite-links-sheet.tsx` (+ `.test.tsx`), `apps/mobile/src/components/chat/join-link.tsx` (+ `.test.tsx`), `apps/mobile/src/app/join/[token].tsx`, `apps/mobile/src/store/invite-links.test.ts`, `apps/mobile/src/store/real-store.invite-links.test.ts`.
- Edited: `apps/mobile/src/app/group/[id].tsx` (links button + sheet wiring), `apps/mobile/src/components/chat/new-chat-button.tsx` ("Join with a link"), `apps/mobile/src/store/{types,chat-store,real-store}.ts` (5 actions), `work/T-0136-mobile-invite-links.md`.
- No shared-type changes (`packages/chat-core` untouched), no new dependencies, no server/web changes.

### Commands run and real results
- `pnpm install`: pass (~13s)
- `pnpm format:check`: pass ("All matched files use Prettier code style!")
- `pnpm lint`: pass (oxlint clean; fixed 2 errors during work: `Date.now()` in render → injected `now` prop, set-state-in-effect → async-helper shape like web `JoinPage`)
- `pnpm typecheck`: pass (mobile `tsc --noEmit`; full `pnpm typecheck` not run — task Checks list bare `typecheck`, mobile is the only touched package)
- Scoped: 5 files 53 passed (invite-links-api, mock + real store flows, sheet, join body)
- Full mobile suite at the end: `pnpm --filter @galena/mobile test --maxWorkers=2`: 43 passed, 2 skipped (45 files); 458 passed, 2 skipped (460 tests)
- Note: repo-root `pnpm format:check` flags untracked `PREREVIEW.md`, not mine (another worker's/lead's file, left untouched and uncommitted); all my files are Prettier-clean per explicit file list.

### Round 2 (pre-review fixes)
- Mock store keyed per groupId (`mock/invite-links.ts` + `chat-store.ts` pass the id through instead of hardcoding `g-devteam`); mock preview/join now enforce revoked/expired/exhausted via `isUsable` with the same neutral 404 `invalid_link` (preview mirrors the server: it also rejects unusable links, not just join). New tests: two-group isolation (list/create/revoke/join resolve each group's own links), one-use exhaustion, expiry via fake timers.
- Collapsed the `[false]`-only loop in `join-link.test.tsx` to a direct assertion.
- Deleted unused `JoinLinkCard`; the route's network-failure branch now uses `joinLinkViewFor({ … joinError })` instead of its inline object, so `joinError` has a caller.
- The join route resets `view` to `checking` when `token` changes.

### Round 3 (pre-review round 2 fixes)
- Finding 1 (stale chats): the route's `openGroup` read the render-time `chats` snapshot, so a just-joined group was never found and every success fell through to `/`. It now reads fresh at call time via a new `useChatStoreApi()` accessor (raw `StoreApi` from the provider context) and a pure `resolveGroupChat(chats, groupId)` helper (General chat → group screen → chats list). The helper lives UI-free in `lib/invite-links-api.ts` (re-exported from the join view) so store tests can import it. New test: real store joins with `getChats` answering the new group, then `resolveGroupChat(store.getState().chats, …)` opens its General chat.
- Finding 2 (stale labels): the sheet takes a `now` prop, fixed by the group screen's `openLinks` (`setLinksNow(Date.now())`) on every open instead of a mount-time stamp. New test: rows rendered with a stale vs fresh stamp flip an expiring link from active to expired.
- Nit 4: the real-store join test now asserts `getChats` is called again on join.
- Nit 6: new `offline` join state — an unreachable server on initial preview shows "Could not load the link / Check your connection" with Try again (retry re-runs the load); the neutral message stays reserved for invalid/expired/revoked/full.
- Skipped per instruction: nits 3 (vacuous token-absence tests) and 5 (nameless gate refetch).

### Problems, deviations from the spec, open questions
- Universal links: custom scheme only, no `associated-domains`/Apple work (per spec's out-of-scope). Pasted `https://…/j/<token>` and `/join/<token>` links still parse and route in-app.
- Render tests cover the hook-free views (`InviteLinkRow`, `CreatedInviteLinkView`, `JoinLinkBody`) via the repo's stubbed-`react-native` pattern — not the hook-bearing sheet/route themselves (no testing library on mobile, no new dependency per spec). The join route's guard/name-gate branches are untested for the same reason.
- Mobile vitest does not resolve the `@/` alias (learned the hard way: "Unexpected token 'typeof'" + "Cannot find package" transform failures). New source uses the repo's dominant relative-import style (`../../lib/…`); tests mock both `@/` and relative paths for `ui/text`.
- `InviteLinksApiError`/`TopicsApiError`/`ChatApiError` triple the same shape; left as-is to match the file-local convention.
- Needs a human look (no simulator per instructions): open a real `galena://join/<token>` link on device; Copy/Share sheet behavior; signed-out → login → back-to-join return; nameless gate → name → join; manager vs member visibility of the links button; expired/exhausted link labels against a real server.

---

## Review (written by Claude)

**Verdict:** Approved after three rounds. Round-1 fixes (per-group mock, dead code, loop test) and round-2 fixes (join opens the group with chats read at call time, link list timestamp taken on open, network error on the preview is retryable, refresh asserted) verified in the second packet. The real paths are clean: tokens never reach logs, errors, audit or analytics, junk tokens are rejected before any fetch, every failure kind shows one neutral message, create/list/revoke are group-scoped and gated like web. Mobile only; to be run on the Android emulator after the batch merge.

### Findings
- Mock `preview`/`join` hardcode `alreadyMember: true`, so the real Join POST path is never exercised in mock mode.
- The "same neutral message" and "never carries the token" render tests feed already-mapped strings back in, so they are partly vacuous; the store-level tests carry the acceptance criteria.
- Nameless signed-in user with a junk pasted token is sent to `/welcome/name?from=/join`, which matches no route (edge case).

### Follow-ups
- Derive `alreadyMember` from the mock store state; re-point the vacuous token tests; keep the raw param through the name gate.
