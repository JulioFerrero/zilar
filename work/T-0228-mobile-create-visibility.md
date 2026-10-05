---
id: T-0228
title: "Mobile: New group and New channel can be created Public with an @handle (live availability check)"
status: merged
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

### What I did
- `groups-api.ts`: `createChannel` and `createGroup` accept optional
  `visibility`/`handle` and send `{ visibility: 'public', handle }` only
  when `visibility === 'public'`; private bodies are byte-identical to before.
- Store (`types.ts`, `real-store.ts`, `chat-store.ts`): both create methods
  accept and forward `visibility?`/`handle?`, trimmed in `real-store.ts`.
- New `components/chat/visibility-fields.tsx`: `VisibilityFields`
  (Private/Public segmented row, per-kind muted line, Handle field with
  placeholder `hiking_club`, max 32, no autocapitalize/autocorrect,
  accessibility label `Group handle`, live `@handle is available` / reason
  text reusing `visibilityReasonText`), `useHandleCheck` (300 ms debounce,
  `checkGroupHandle`, `rate_limited` → unavailable, other errors → null,
  stale results ignored), `publicCreateError` (empty-handle guard per kind +
  unavailable-check reason), `createErrorText` (four handle codes like
  `visibilitySaveError`, per-kind fixed fallback, never server text), plus
  `channelCreateGuard`/`buildChannelCreateInput` so the stateful channel
  sheet is testable without a renderer.
- `new-group-sheet.tsx` (name step) and `new-channel-sheet.tsx`: render
  `VisibilityFields`, block Create on the guards, pass
  `visibility`/`handle` in `onCreate`. Switching back to Private hides the
  field and clears the check via `reset()`.
- `new-chat-button.tsx`: `create`/`submitGroup` forward
  `visibility`/`handle` to the store and show `createErrorText(error, kind)`
  on failure (fixed sentences, never raw).
- Tests: extended `groups-api.test.ts` (public body has both fields, private
  has neither), new `visibility-fields.test.tsx` (lines, field visibility,
  available/reason texts, `publicCreateError`, `createErrorText`),
  extended `new-group-sheet.test.tsx` (guards + body render checks),
  new `new-channel-sheet.test.tsx` (guard/payload builders + error lines),
  extended `real-store.groups-create.test.ts` (forwarding + trim).

### Checks
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot
  <5 spec files>`: 5 passed, 57 passed (ran again after prettier: GATE PASS
  implies the suite stayed green).
- `new-chat-button.test.tsx` + `visibility-sheet.test.ts`: 2 passed,
  6 passed (regression check on the touched wrapper/shared helper).
- `pnpm gate`: GATE PASS — install PASS, format PASS, lint PASS, typecheck
  PASS, tests @zilar/mobile PASS, scope: every changed file is inside the
  Allowed files (14 changed files).

### Problems / deviations
- The new-channel sheet is stateful (hooks), and this repo has no RN
  renderer, so its Node test covers the guard/payload builders and error
  lines rather than pressing buttons; the sheet wires them unchanged.
- Accidental stray edit to `directory-api.ts` (outside Allowed) during
  planning was reverted immediately; `git diff` confirms it is clean.
- Prettier reformatted 5 files; an edit duplicated the channel-sheet import
  block once — fixed, gate is green.

### Security checklist
- No secrets/tokens in logs or errors; handle strings go only in the POST
  body, never URLs. No deletes/updates touched. No caps/uniqueness logic
  added (server owns the 409 race). No new routes. All errors are fixed
  sentences; raw server text never reaches the UI.

### Round 2 (fix round, PREREVIEW findings)
- Finding 1 (must-fix, debounce loop): `useHandleCheck` no longer takes the
  inline `check` closure in its effect deps — it runs through a ref
  (`visibility-fields.tsx`), and both sheets pass a `useCallback`-memoized
  checker keyed on the memoized `directoryApi`. Added a regression test in
  `visibility-fields.test.tsx` (minimal React hook stub with dep
  comparison: one check per handle, quiet after the result re-render;
  verified it fails on the old code with `expected 2 to be 1`). Also fixed
  the group-sheet guard order as a side effect of the wiring change below:
  empty name now reports before the handle guard, matching web.
- Finding 2 (should-fix, mocked wrapper test): `new-group-sheet.test.tsx`
  no longer mocks `visibility-fields`; the wrapper's Create path is
  extracted into `groupCreateGuard`/`buildGroupCreateInput` in
  `visibility-fields.tsx` (mirroring the channel builders) and tested
  against the real code, including that `onCreate` receives trimmed
  `visibility: 'public'` + `handle` (a dropped field fails the test). The
  body render test now asserts the real `VisibilityFields` output (Public
  shows the name field + handle field).
- Nits: `visibility-fields.test.tsx` and `new-channel-sheet.test.tsx` now
  import the real `visibilityReasonText` instead of a hand copy (added the
  missing `react-native-safe-area-context` mock the real chain needs);
  `real-store.groups-create.test.ts` covers the `createChannel`
  visibility/handle forwarding + trim. Guard-order nit resolved by the
  finding-2 refactor (name first, like web).
- Disagreements: none.
- Checks: `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot
  groups-api visibility-fields new-group-sheet new-channel-sheet
  real-store.groups-create`: 5 passed, 59 passed. `pnpm gate`: (below).
- Gate: GATE PASS — install PASS, format PASS, lint PASS, typecheck PASS,
  tests @zilar/mobile PASS, scope: every changed file is inside the Allowed
  files (14 changed files).


## Review (written by Claude)

**Verdict:** Approved after one auto round (1 must-fix, 1 should-fix, fixed and verified). Final packet clean with 2 cosmetic nits (a stale comment; "Checking…" can stick for one check after toggling Private/Public mid-flight), left as is. Read `groups-api.ts`: `visibility`/`handle` are sent only for public creates; private bodies are unchanged. Emulator QA of both sheets (mock mode, nothing created on the server) runs in parallel in the QA subagent.
