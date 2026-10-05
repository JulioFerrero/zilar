---
id: T-0214
title: Mobile: New group sheet (pick contacts, name the group) replaces "Coming soon"
status: planned
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
`apps/mobile/src/lib/groups-api.ts`, `apps/mobile/src/lib/groups-api.test.ts`, `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/chat-store.ts`, `apps/mobile/src/store/real-store.groups-create.test.ts` (new), `apps/mobile/src/components/chat/new-group-sheet.tsx` (new), `apps/mobile/src/components/chat/new-group-sheet.test.tsx` (new), `apps/mobile/src/components/chat/new-chat-button.tsx`, `work/T-0214-mobile-new-group-sheet.md`.

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

## Review (written by Claude)
