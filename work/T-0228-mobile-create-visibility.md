---
id: T-0228
title: "Mobile: New group and New channel can be created Public with an @handle (live availability check)"
status: planned
milestone: M5
branch: task/T-0228-mobile-create-visibility
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0214]
estimate: 0.5 day
---

# T-0228: Private or Public when creating a group or channel

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mobile-parity-gaps.md` 7.2 "T-0190c" (lines 1144-1161). On web, `NewGroupDialog` (used for groups and channels) has a Private / Public choice; Public asks for an `@handle` with a live availability check, and the server creates the group with the handle in one step. The phone's New group sheet (T-0214) only creates private groups and the New channel sheet only has a name and a description.

### What the person sees
In both sheets, before the Create button (in the New group sheet: on the name step), a two-option segmented row `Private` / `Public` (Private selected by default), and under it one muted line:
- group: `Only invited people can join this group.` / `Anyone can find and join this group.`
- channel: `Only invited people can join this channel.` / `Anyone can find and join this channel.`
With Public selected, a `Handle` field (placeholder `hiking_club`, no autocapitalize or autocorrect, max 32, accessibility label `Group handle`) with a live check 300 ms after typing stops: `@<handle> is available` (positive) or the reason sentence (danger). Create with Public:
- empty handle → `Choose a handle for the public group.`;
- a check that said unavailable → its reason sentence;
- server errors → the fixed sentences below. Switching back to Private hides the field and clears the check.
Reason and error sentences are the ones already in `apps/mobile/src/components/chat/visibility-sheet.tsx` (`visibilityReasonText` line 19, and the `handle_invalid` / `handle_reserved` / `handle_taken` / `rate_limited` cases of `visibilitySaveError` lines 32-50); everything else stays `Could not create the group. Try again.` / `Could not create the channel. Try again.` Never server text.

### Verified facts (do not re-derive)
- Server `POST /groups` schema `apps/server/src/groups/routes.ts` lines 50-63: `title`, `memberIds` (default `[]`), `kind?: 'group'|'channel'`, `description?`, `visibility?: 'private'|'public'`, `handle?` (1-64); public creates the handle in one transaction, 409 `handle_taken` on a race.
- Web reference `apps/web/src/components/NewGroupDialog.tsx` (377 lines): debounced check (lines 49-80), `create` (lines 87-132) with the Public guards, visibility radio and lines (about 230-272), handle input (273-300), `handleReasonText` and `friendlyCreateError` (lines 346-377).
- Mobile API `apps/mobile/src/lib/groups-api.ts`: `GroupsApi.createChannel(input: { title; description? })` (line 20, impl lines 146-165), `createGroup(input: { title; memberIds })` (line 22, from T-0214).
- Mobile store `apps/mobile/src/store/types.ts`: `createChannel` (line 360), `createGroup` (line 365); `apps/mobile/src/store/real-store.ts`: `createChannel` (line 3791), `createGroup` (line 3811). Mock store `apps/mobile/src/store/chat-store.ts`.
- Handle check on mobile: `DirectoryApi.checkGroupHandle(handle)` (`apps/mobile/src/lib/directory-api.ts` line 309, `GET /api/handles/check?handle=&kind=group`), hook `useDirectoryApi()` (`apps/mobile/src/components/directory/use-directory-api.ts` line 20); the debounced pattern with `rate_limited` handling is in `apps/mobile/src/app/group/[id].tsx` lines 300-330.
- Sheets: `apps/mobile/src/components/chat/new-group-sheet.tsx` (T-0214, two steps, `onCreate({ title, memberIds })`), `apps/mobile/src/components/chat/new-channel-sheet.tsx` (101 lines, `onCreate({ title, description? })`), both opened from `apps/mobile/src/components/chat/new-chat-button.tsx`.

### What to build
1. `groups-api.ts`: `createChannel` and `createGroup` accept optional `visibility` and `handle` and send them only when `visibility === 'public'` (`{ visibility: 'public', handle }`); nothing changes for private.
2. Store (`types.ts`, `real-store.ts`, `chat-store.ts`): both create methods accept and forward `visibility?` and `handle?` (trimmed).
3. New `apps/mobile/src/components/chat/visibility-fields.tsx`: `VisibilityFields({ kind: 'group' | 'channel', visibility, onVisibility, handle, onHandle, check })` rendering the row, the line and the handle field with the check text; plus a hook `useHandleCheck(visibility, handle)` (300 ms debounce, `checkGroupHandle`, `rate_limited` → unavailable with reason `rate_limited`, other errors → no result, ignore results after unmount) and a pure `publicCreateError(visibility, handle, check)` returning the guard sentence or `undefined`. Reuse `visibilityReasonText`; for create errors add `createErrorText(error, kind)` mapping the four codes like `visibilitySaveError` and the fixed fallback.
4. `new-group-sheet.tsx` (name step) and `new-channel-sheet.tsx`: render `VisibilityFields`, block Create on the guards, pass `visibility`/`handle` in `onCreate`; `new-chat-button.tsx` forwards them to the store and shows `createErrorText` on failure.
5. Tests (Vitest): `apps/mobile/src/lib/groups-api.test.ts` (public body has `visibility` and `handle`; private body has neither); new `apps/mobile/src/components/chat/visibility-fields.test.tsx` (lines for group and channel, field only on Public, available and reason texts, `publicCreateError` cases, `createErrorText` codes and fallback for both kinds); `apps/mobile/src/components/chat/new-group-sheet.test.tsx` and a new `apps/mobile/src/components/chat/new-channel-sheet.test.tsx` (Public without a handle blocks Create with the sentence; `onCreate` receives visibility and handle).

### Read first
`AGENTS.md`, `apps/web/src/components/NewGroupDialog.tsx`, `apps/mobile/src/components/chat/new-group-sheet.tsx`, `apps/mobile/src/components/chat/new-channel-sheet.tsx`, `apps/mobile/src/components/chat/new-chat-button.tsx`, `apps/mobile/src/components/chat/visibility-sheet.tsx`, `apps/mobile/src/lib/groups-api.ts` (lines 1-40 and 140-190), `apps/mobile/src/app/group/[id].tsx` (lines 290-340).

### Allowed files
`apps/mobile/src/lib/groups-api.ts`, `apps/mobile/src/lib/groups-api.test.ts`, `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/chat-store.ts`, `apps/mobile/src/store/real-store.groups-create.test.ts`, `apps/mobile/src/components/chat/visibility-fields.tsx` (new), `apps/mobile/src/components/chat/visibility-fields.test.tsx` (new), `apps/mobile/src/components/chat/new-group-sheet.tsx`, `apps/mobile/src/components/chat/new-group-sheet.test.tsx`, `apps/mobile/src/components/chat/new-channel-sheet.tsx`, `apps/mobile/src/components/chat/new-channel-sheet.test.tsx` (new), `apps/mobile/src/components/chat/new-chat-button.tsx`, `work/T-0228-mobile-create-visibility.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot groups-api visibility-fields new-group-sheet new-channel-sheet real-store.groups-create
pnpm gate
```

### Acceptance
- Both sheets offer Private / Public; Public needs a handle with the live check; the request carries `visibility: 'public'` and the handle; private requests are unchanged; every error is a fixed sentence.
- No server, web or package change; no new dependency; no emoji; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Picking members for a channel, the description for a group, changing visibility after creation (exists in group settings).

---

## Report (written by the worker when done)

## Review (written by Claude)
