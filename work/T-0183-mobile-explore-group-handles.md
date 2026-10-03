---
id: T-0183
title: Mobile: Explore public groups and channels, open @group links, group visibility and handle
status: review
milestone: M5
branch: task/T-0183-mobile-explore-group-handles
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: []
estimate: 1 day
---

# T-0183: Mobile: Explore public groups and channels, open @group links, group visibility and handle

## Spec (written by Claude, do not edit)

### Why
Web has an Explore page for public groups and channels, `@handle` group links and a visibility section in group settings. The phone has none of these. Julio, 2026-10-03: "implement all the features we have in web into the mobile app". Roadmap: `docs/ROADMAP_MOBILE_PARITY.md`.

### Verified facts (do not re-derive)
- Web: `apps/web/src/components/ExplorePage.tsx`, `apps/web/src/routes/GroupHandleRoute.tsx`, `apps/web/src/components/VisibilitySection.tsx`; client functions in `apps/web/src/lib/api.ts`: `searchDirectory({ q, kind, cursor })` (~2112), `lookupGroupByHandle(handle)` (~2129), `joinPublicGroup(groupId)` (~2143), `setGroupVisibility(...)` (~2152), `checkGroupHandle(handle)` (~2166).
- Server: `apps/server/src/directory/routes.ts` (read the header comment: public groups and channels only, never users or private groups; 20 per page with a cursor; reads are rate limited 30 per 10 minutes) and the visibility route in `apps/server/src/groups/`.
- Mobile: group screen `apps/mobile/src/app/group/[id].tsx`, `components/chat/group-roles-sheet.tsx` and `invite-links-sheet.tsx` (sheets in group settings), `lib/groups-api.ts`.
- Conventions (all mobile parity tasks): API module in `apps/mobile/src/lib/<area>-api.ts` mirroring the web client function names, validated at the boundary, with an error class carrying `status` and `code`; a hook that returns the real API or the mock (copy `use-ais-api.ts`); screens under `apps/mobile/src/app/`, guarded by `RequireAuth`; components under `apps/mobile/src/components/<area>/`; lucide icons, no emoji; every list has loading, empty and error states; no new dependency (`expo-image-picker`, `expo-document-picker`, `expo-clipboard`, `zod` are already installed); never log tokens, codes or message text.

### What to build
1. `apps/mobile/src/lib/directory-api.ts` (+ tests): `searchDirectory`, `lookupGroupByHandle`, `joinPublicGroup`, `setGroupVisibility`, `checkGroupHandle`.
2. `apps/mobile/src/app/explore.tsx`: a search field, a kind filter (all, groups, channels), the result list with member count and a Join / Open button, infinite scroll by cursor, empty and error states, the 429 as 'Too many searches, try again in a few minutes'. Reach it from the new-chat entry (row 'Explore') in `new-chat-button.tsx`.
3. `apps/mobile/src/app/at/[handle].tsx` and the deep link `zilar://at/<handle>` (also `https://<host>/@handle` if the app's link config already handles host links; check how `app/join/[token].tsx` is wired): the group card with Join or Open.
4. In group settings add a Visibility sheet (private or public, the @handle with the live availability check), only for people who may change it (same rule as web `VisibilitySection`).
5. Tests (Vitest): API, the explore screen states, the handle route (found, 404, already member), the visibility sheet (permission, handle taken).

### Read first
`AGENTS.md`, `docs/ROADMAP_MOBILE_PARITY.md`, `docs/design/ui-style.md`, `apps/mobile/src/lib/approvals-api.ts` and `apps/mobile/src/lib/ais-api.ts` (the API module pattern: type guards or zod, an error class with `status` and `code`), `apps/mobile/src/components/ais/use-ais-api.ts` and `require-ais-auth.tsx` (the real-or-mock hook and the auth guard), `apps/mobile/src/app/ais/index.tsx` (a screen with header, list, empty and error states), plus the web files named above.

### Allowed files
`apps/mobile/src/lib/directory-api.ts` and tests, `apps/mobile/src/app/explore.tsx`, `apps/mobile/src/app/at/**`, `apps/mobile/src/components/directory/**`, `apps/mobile/src/components/chat/visibility-sheet.tsx` and its test, `apps/mobile/src/components/chat/new-chat-button.tsx` (one row), `apps/mobile/src/app/group/[id].tsx` (only to open the visibility sheet).

### Checks
```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/mobile test --maxWorkers=2 explore directory visibility
```
Say in the Report that the lead tests on the emulator and the phone.

### Acceptance
- Explore lists public groups and channels, pages by cursor, and joins one.
- `zilar://at/<handle>` opens the group card.
- A group admin can switch visibility and set the @handle from the phone.
- No emoji in UI, no new dependency, no server change, no unrelated file touched.

### Out of scope
Creating a group (exists), user search, trending or recommendations.

---

## Report (written by the worker when done)

Implemented Explore, the `@handle` route and the visibility sheet on mobile,
mirroring the web T-0164 behaviour with no server change and no new
dependency (`zod` is installed but the mobile convention is type guards, so
the API module uses guards like `chat-api.ts`).

What was built:
- `apps/mobile/src/lib/directory-api.ts` (+ `directory-api.test.ts`, 8
  tests): `searchDirectory` (q/kind/cursor), `lookupGroupByHandle`,
  `joinPublicGroup`, `getGroupVisibility` (reads the visibility slice from
  `GET /api/groups/:id`, since the mobile `GroupDetail` parser drops
  `visibility`/`handle`), `setGroupVisibility` (exact PATCH body via
  `buildVisibilityBody`), `checkGroupHandle`. `DirectoryApiError` carries
  `status` and `code`.
- `apps/mobile/src/app/explore.tsx` (+ `components/directory/`
  `explore-helpers.ts` + test, `use-directory-api.ts`): search field,
  all/groups/channels filter, rows with title, @handle, description, member
  count and Join/Open, cursor paging (`Show more` + infinite scroll via
  `onEndReached`), loading/empty/error states, 429 reads "Too many
  searches, try again in a few minutes". Guarded by `RequireAuth`; mock
  scenarios via `mock/directory.ts` (`default`/`empty`/`error`).
- New-chat entry: one `Explore` row in `new-chat-button.tsx` pushing
  `/explore`.
- `apps/mobile/src/app/at/[handle].tsx` (+ `components/directory/`
  `handle-helpers.ts` + `handle-route.test.ts`): `zilar://at/<handle>` opens
  the group card with Join/Open; 404 (unknown and private alike) reads the
  same neutral not-found line; other failures show Retry. Signed-out users
  redirect to login with `from` preserved. Note: only the `zilar://`
  scheme is wired — `app.json` has no universal/applinks host config, so
  `https://<host>/@handle` is not handled; that needs a native config
  change outside Allowed files.
- Visibility sheet: `components/chat/visibility-sheet.tsx` (+ test:
  permission, handle taken) with private/public pick, @handle field, live
  availability check (own handle skipped), going-private confirm step and
  copy-share-link (`zilar://at/<handle>`); owner-only gate
  (`mayChangeVisibility` = owner, same rule as web `GroupPanel`); wired
  into `app/group/[id].tsx` behind an Eye header button with the
  `linksShare` clipboard bridge reused. After save the detail refreshes via
  `refreshGroupDetail`.

Files changed:
- new: `lib/directory-api.ts`, `lib/directory-api.test.ts`, `app/explore.tsx`,
  `app/at/[handle].tsx`, `components/directory/use-directory-api.ts`,
  `components/directory/explore-helpers.ts`,
  `components/directory/explore-helpers.test.ts`,
  `components/directory/handle-helpers.ts`,
  `components/directory/handle-route.test.ts`,
  `components/chat/visibility-sheet.tsx`,
  `components/chat/visibility-sheet.test.ts`, `mock/directory.ts`
- edited: `components/chat/new-chat-button.tsx` (one Explore row),
  `app/group/[id].tsx` (visibility sheet wiring only)

Commands and real results:
- `pnpm install`: done (9.3s).
- `pnpm format:check`: pass ("All matched files use Prettier code style!").
- `pnpm lint`: pass (no errors).
- `pnpm --filter @zilar/mobile typecheck`: pass.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 explore directory visibility`:
  4 files, 17 tests, all pass.

Problems / deviations:
- The spec asks for `https://<host>/@handle` "if the app's link config
  already handles host links" — it does not (only `"scheme": "zilar"` in
  `app.json`), so only `zilar://at/<handle>` works. No config touched
  (outside Allowed files).
- `getGroupVisibility` reads the full group detail route and parses only
  the visibility slice, instead of extending the shared `GroupDetail`
  parser in `chat-api.ts` — a smaller, task-scoped change.
- The lead tests on the emulator and the phone (per the task Checks note).

Security checklist: no tokens/codes/message text logged (errors map
status/code to neutral lines only); no deletes/updates outside the group
scope; no new caps needed (server enforces rate limits, handle uniqueness
and the 14-day interval); permission checked before effect (owner-only
sheet, session guard on both routes); 404 shared for unknown and private;
both new routes sit behind `RequireAuth`; audit is server-side.

Open questions: none.

## Review (written by Claude)
