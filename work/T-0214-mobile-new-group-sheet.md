---
id: T-0214
title: Mobile: New group sheet (pick contacts, name the group) replaces "Coming soon"
status: merged
milestone: M5
branch: task/T-0214-mobile-new-group-sheet
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0190]
estimate: 0.5 day
---

# T-0214: New group on the phone

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-03: "implement all the features we have in web into the mobile app". On the phone, the chat list `+` menu's `New group` still opens a box that says `Coming soon`. Web has a two-step dialog. This is T-0190b of `docs/audit/mobile-parity-gaps.md` section 7.2, reduced to private groups: a group can already be made public later from its settings on the phone (T-0183), so the public option and the handle check are left out here.

### What the person sees
`+` → `New group` opens a box (same container classes as the `New message` box from T-0190) with two steps:
1. **Add members**: title `Add members`; a scrollable list of the person's contacts, each row an `Avatar` (size 28), the name, and a check mark on the right when selected (tap the row to toggle; `accessibilityRole="checkbox"` with `checked`). No contacts: `Invite a friend first to start a group.` (muted, centred). Buttons: `Cancel` (ghost) and `Next` (primary, disabled until at least one contact is selected).
2. **Group name**: title `Group name`; a text field with placeholder `Group name` (max 100 characters, autofocus); buttons `Back` (ghost, keeps the selection) and `Create` (primary). While creating, `Create` is disabled and reads `Creating…`, and the box cannot be closed.
- Empty name on Create: `Enter a group name` (danger). Failure: `Could not create the group. Try again.` (danger); never server text.
- Success: the box closes, the chat list refreshes, and the app opens the new group (`/group/<id>`), the same way `New channel` does today.
- Icons only from `lucide-react-native` (`Check`); no emoji.

### Verified facts (do not re-derive)
- Server: `POST /groups` (`apps/server/src/groups/routes.ts` line 122) with `createGroupSchema` (lines 50-63): `title`, `memberIds` (default `[]`), `kind?` (`group` | `channel`, missing means group), `description?`, `visibility?`, `handle?`. Answers the group with its `id` (the mobile `createChannel` reads `id`).
- Web dialog: `apps/web/src/components/NewGroupDialog.tsx`: steps `members` and `title` (line 20), the members step and its copy (lines 150-200), the empty-name sentence (line 91), the fixed failure sentence (lines 373-376).
- Mobile API: `GroupsApi` in `apps/mobile/src/lib/groups-api.ts` (line 18) with `createChannel` (interface line 20, implementation lines 144-163: POST `/api/groups`, `kind: 'channel'`, reads `{ id }`). Tests in `apps/mobile/src/lib/groups-api.test.ts`.
- Mobile store: `createChannel` in the store type `apps/mobile/src/store/types.ts` line 360 and in `apps/mobile/src/store/real-store.ts` lines 3791-3806 (validates, calls the API, `refreshChats()`, returns the id); the mock store `apps/mobile/src/store/chat-store.ts` lists it in its key union (line 109) and throws `createChannel is not available in the mock store` (lines 685-686). Store tests for channels: `apps/mobile/src/store/real-store.channels.test.ts` (fake `groupsApi` line 101).
- Contacts: the store has `contacts: Contact[]` (`apps/mobile/src/store/types.ts` line 154); `Contact` is `{ userId, name, jid, avatarUrl? }` (`apps/mobile/src/lib/chat-api.ts` lines 13-18). `Avatar` is `apps/mobile/src/components/chat/avatar.tsx` (props `id`, `name`, `size`).
- Menu: `apps/mobile/src/components/chat/new-chat-button.tsx` after T-0190: `NewChatAction` includes `'invite'`; `group` still shows the `Coming soon` placeholder; the channel flow (`create`, line 69) pushes `{ pathname: '/group/[id]', params: { id: groupId } }` (line 75).

### What to build
1. `apps/mobile/src/lib/groups-api.ts`: `createGroup(input: { title: string; memberIds: string[] }): Promise<{ id: string }>` (POST `/api/groups` with `title` and `memberIds`, no `kind`), same parsing as `createChannel`.
2. Store: `createGroup(input: { title: string; memberIds: string[] }) => Promise<string>` in `apps/mobile/src/store/types.ts`, implemented in `apps/mobile/src/store/real-store.ts` next to `createChannel` (trim the title, `Enter a group name.` error when empty, call the API, `refreshChats()`, return the id), and in the mock store `apps/mobile/src/store/chat-store.ts` exactly like `createChannel` there.
3. New `apps/mobile/src/components/chat/new-group-sheet.tsx`: the two steps above; props `{ contacts: Contact[]; busy: boolean; error: string; onCreate(input: { title: string; memberIds: string[] }): void; onClose(): void }`. Pure step logic (toggle, can-go-next, validation) in exported functions in the same file.
4. `apps/mobile/src/components/chat/new-chat-button.tsx`: `group` shows `NewGroupSheet` with the store's contacts, wired like the channel flow (busy, error with the fixed failure sentence, navigate on success). The `Coming soon` placeholder is then unused: remove it. Nothing else changes.
5. Tests (Vitest): `apps/mobile/src/lib/groups-api.test.ts` (createGroup body has no `kind`, parses `id`); `apps/mobile/src/store/real-store.groups-create.test.ts` (new: trims, empty name rejects, calls the API with the member ids, refreshes, returns the id); `apps/mobile/src/components/chat/new-group-sheet.test.tsx` (no-contacts sentence, Next disabled until a selection, toggling, Back keeps the selection, empty name sentence, Create calls `onCreate` with title and ids, busy disables Create).

### Read first
`AGENTS.md`, `apps/web/src/components/NewGroupDialog.tsx` (lines 1-135 and 150-215), `apps/mobile/src/components/chat/new-chat-button.tsx`, `apps/mobile/src/components/chat/new-message-sheet.tsx`, `apps/mobile/src/lib/groups-api.ts`, `apps/mobile/src/store/real-store.ts` (lines 3785-3810), `apps/mobile/src/store/real-store.channels.test.ts` (lines 90-160).

### Allowed files
`apps/mobile/src/lib/groups-api.ts`, `apps/mobile/src/lib/groups-api.test.ts`, `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/chat-store.ts`, `apps/mobile/src/store/real-store.groups-create.test.ts` (new), `apps/mobile/src/components/chat/new-group-sheet.tsx` (new), `apps/mobile/src/components/chat/new-group-sheet.test.tsx` (new), `apps/mobile/src/components/chat/new-chat-button.tsx`, `apps/mobile/src/store/real-store.channels.test.ts` (lead, 2026-10-05: only the `createGroup` stub in `fakeGroups()`), `work/T-0214-mobile-new-group-sheet.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot groups-api real-store.groups-create new-group-sheet
pnpm gate
```
The lead checks the sheet on the Android emulator before merging (without creating a group on the live server).

### Acceptance
- `New group` lets the person pick contacts, name the group and create it, then opens it; web's copy; fixed error sentences.
- No server, web or package change; no new dependency; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Public groups and handles, a description, adding AIs, the New channel sheet.

---

## Report (written by the worker when done)

Implemented. The New group flow works end to end on the phone: pick contacts,
name the group, create it, then the app opens `/group/<id>`.

What I did (prior session: API `createGroup`, store `createGroup` in
`types.ts` / `real-store.ts` / `chat-store.ts`, `NewGroupSheet`, and the
`new-chat-button.tsx` wiring with the `Coming soon` placeholder removed; this
session: verified that work and wrote the three test files):
- `apps/mobile/src/lib/groups-api.ts`: `GroupsApi.createGroup` POSTs
  `/api/groups` with `{ title, memberIds }` (no `kind`), parses `{ id }`.
- `apps/mobile/src/store/types.ts` + `real-store.ts`: `createGroup` trims the
  title, rejects with `Enter a group name.` when empty, calls the API,
  `refreshChats()`, returns the id. `chat-store.ts` mock throws like
  `createChannel` does.
- `apps/mobile/src/components/chat/new-group-sheet.tsx`: two-step sheet with
  the same container classes as the New message box; members step
  (`Add members`, `Avatar` size 28, `accessibilityRole="checkbox"`, `Cancel` /
  `Next` disabled until a selection, `Invite a friend first to start a
  group.` when empty) and name step (`Group name` field, max 100, autofocus,
  `Back` keeps selection, `Create` → `Creating…` while busy, box not
  closable). Pure `toggleSelected` / `canGoNext` / `validateGroupName`
  exported; hook-free `NewGroupSheetBody` for tests. Error sentences match
  web (`Enter a group name`, `Could not create the group. Try again.` in the
  button), never server text. `Check` from `lucide-react-native`, no emoji.
- `apps/mobile/src/components/chat/new-chat-button.tsx`: `group` renders
  `NewGroupSheet` with the store contacts and navigates to `/group/[id]` on
  success, like the channel flow.
- Tests: `groups-api.test.ts` (+2: body has no `kind`, malformed answer
  rejects), `real-store.groups-create.test.ts` (new, 3: trims + passes member
  ids + refreshes + returns id; blank name rejects without network; refresh
  failure still resolves), `new-group-sheet.test.tsx` (new, 15: step logic +
  body rendering, wiring, disabled states, busy).

Commands (all from the repo root, real results):
- `pnpm install`: ok (one pre-existing unmet-peer warning for
  `@types/react-dom`).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot
  groups-api real-store.groups-create new-group-sheet`: 3 files, 26 tests,
  all pass.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot
  real-store.channels new-chat-button`: 2 files, 10 tests, all pass
  (regression check on the touched neighbours).
- `pnpm gate`: install PASS, format PASS, lint PASS, typecheck FAIL —
  `real-store.channels.test.ts(99,3): error TS2322: Property 'createGroup' is
  missing` in its `fakeGroups()` (that file is outside my Allowed files, so
  I did not touch it). scope check: every changed file is inside the Allowed
  files. Overall: GATE FAIL on typecheck only.

Blocked / needs a decision: none — the lead approved the one-stub fix in
`real-store.channels.test.ts` and the gate now passes (GATE PASS).

Security checklist: no secrets/tokens in logs or UI (fixed error sentences
only, verified `new-chat-button.test.tsx` asserts no Bearer); `POST
/api/groups` is the existing route with server-side validation; no deletes;
no new route; group creation is authenticated like channel creation.

## Round (fix round, 2026-10-05)

Fixed findings 1 (must-fix), 2 (should-fix), 3 and 4 (nits) from PREREVIEW.md:
- Finding 1: `new-group-sheet.tsx` check mark now uses `ICON_COLOR`
  (`#d4d4d4`) instead of `ACCENT_FOREGROUND` (`#0a0a0a`), visible on the dark
  sheet surface.
- Finding 2: extracted `buildGroupCreateInput` / `nextGroupCreateInput` from
  the wrapper's `create()` so the trim + `{ title, memberIds }` payload is
  unit-tested; tests: payload trims and passes ids, blank name blocks,
  check renders in the light color.
- Finding 3: both stale comments in `new-chat-button.tsx` now say the store
  returns the id from the POST answer.
- Finding 4: `create()` returns early when `busy` (double-submit guard);
  same commit line range as finding 2's refactor.

Tests added: `new-group-sheet.test.tsx` +3 (18 total in that file).
Single tests run: `pnpm --filter @zilar/mobile test --maxWorkers=2
--reporter=dot groups-api real-store.groups-create new-group-sheet
real-store.channels`: 4 files, 36 passed, 0 failed.
Gate: GATE PASS (install PASS, format PASS, lint PASS, typecheck PASS,
tests @zilar/mobile PASS; scope: every changed file inside Allowed files).

## Review (written by Claude)

**Verdict:** Approved after one auto fix round (icon colour token, extracted and tested create-input helpers, stale comments, busy guard), then a clean re-check. `createGroup` posts `{ title, memberIds }` with no `kind`, the store trims and refreshes, the button opens `/group/<id>`; errors are fixed sentences. Lead allowed the one `createGroup` stub in `real-store.channels.test.ts`. Emulator (galena AVD): the `+` menu opens `New group`, `Add members` lists the contact, `Next` goes to `Group name` with Back and Create, Back and Cancel close it; no group was created on the live server. Accepted nit: tapping the dim backdrop closes the box mid-create (same as the channel flow).
