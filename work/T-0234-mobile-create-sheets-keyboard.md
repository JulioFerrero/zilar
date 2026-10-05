---
id: T-0234
title: "Mobile: New group / New channel sheets move above the keyboard; the mock store can create groups and channels and has contacts"
status: merged
milestone: M5
branch: task/T-0234-mobile-create-sheets-keyboard
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0228, T-0233]
estimate: 0.3 day
---

# T-0234: Create sheets and the keyboard, mock create

## Spec (written by Claude, do not edit)

### Why
Emulator QA run 3 of T-0228 (mock build, 2026-10-05; screenshots seen by the lead):
1. With the keyboard open, the Handle field is half hidden and the Create button fully hidden behind it.
2. The first tap outside the focused field only closes the keyboard (seen three times).
3. In mock mode, creating fails with "Could not create the channel. Try again." because the mock store throws on purpose. The group flow could not be tested at all: the mock store has no contacts.

### Verified facts (do not re-derive)
- `apps/mobile/src/components/chat/new-chat-button.tsx`, the action `Modal` (lines 197-247, re-checked after T-0233 merged): a full-screen `Pressable` (`accessibilityLabel="Close dialog"` at line 204, `className="flex-1 items-center justify-center bg-black/40 p-4"`) wraps `NewChannelSheet`, `NewGroupSheet`, `NewMessageSheet`, `InviteSheet` and `JoinLinkForm` (from line 209). No `KeyboardAvoidingView` and no `ScrollView` with `keyboardShouldPersistTaps` around them.
- Mock store `apps/mobile/src/store/chat-store.ts`:
  - `createChannel` (lines 724-731) and `createGroup` (lines 732-739) throw `'... is not available in the mock store'`;
  - the initial state has `contacts: []` (line 164).
- `Contact { userId, name, jid, avatarUrl? }` (`apps/mobile/src/lib/chat-api.ts` lines 13-18). Mock data lives in `apps/mobile/src/mock/` (e.g. `chats.ts`).
- The pattern used in T-0230 for a sheet in a Modal: `KeyboardAvoidingView` with `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}` plus `keyboardShouldPersistTaps="handled"` on the scroll view (`apps/mobile/src/components/ais/tool-detail-sheet.tsx`).

### What to build
1. In the action `Modal`: wrap the content in `KeyboardAvoidingView` (behavior as above, `className="flex-1"`). Inside it, replace the centered `Pressable` layout with a `ScrollView` (`keyboardShouldPersistTaps="handled"`, `contentContainerStyle` centering the sheet with the same padding, `flexGrow: 1`). Keep a full-size backdrop `Pressable` behind the sheet so a tap outside still closes the dialog (same label `Close dialog`). The visual look stays the same when the keyboard is closed.
2. Mock store:
   - `createChannel` and `createGroup` add a new chat to `chats` (title, `kind: 'group'`, `chatKind: 'channel'` for channels, `visibility`/`handle` when public, `unread: 0`, a new id like `mock-group-<n>`) and return its id, like the real store does.
   - `createGroup` rejects with the same error the real store gives when a public handle is `taken` in the mock directory, if the mock directory exposes that; otherwise no handle check.
3. Mock contacts: add three mock contacts (e.g. Ana, Marco, Lena) in a new `apps/mobile/src/mock/contacts.ts`, loaded into `contacts` in the mock store's initial state.
4. Tests:
   - `apps/mobile/src/store/chat-store.test.ts` (or the existing mock store test file): create channel and create group add a chat and return its id; contacts are not empty.
   - A render test for the Modal content if practical (`apps/mobile/src/components/chat/new-chat-button.test.tsx`, only if that file exists; otherwise skip and say so).

### Read first
`AGENTS.md`, `apps/mobile/src/components/chat/new-chat-button.tsx`, `apps/mobile/src/store/chat-store.ts` (lines 150-200 and 715-745), `apps/mobile/src/store/real-store.ts` (`createChannel`, `createGroup`), `apps/mobile/src/mock/chats.ts`, `apps/mobile/src/components/ais/tool-detail-sheet.tsx` (its `KeyboardAvoidingView`).

### Allowed files
`apps/mobile/src/components/chat/new-chat-button.tsx`, `apps/mobile/src/components/chat/new-chat-button.test.tsx`, `apps/mobile/src/store/chat-store.ts`, `apps/mobile/src/store/chat-store.test.ts`, `apps/mobile/src/mock/contacts.ts` (new), `work/T-0234-mobile-create-sheets-keyboard.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot chat-store new-chat-button
pnpm gate
```

### Acceptance
- The sheets stay usable with the keyboard open (field and Create visible, the first tap acts); in mock mode a group or channel can be created and appears in the list; the group flow has contacts to pick.
- No server or web change; no change to the real store; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. The lead checks it on the emulator.

### Out of scope
The chat-list count drop after opening a mock chat (QA noted it; separate).

---

## Report (written by the worker when done)

### What I did
1. Action `Modal` in `new-chat-button.tsx`: wrapped the content in `KeyboardAvoidingView` (`behavior={Platform.OS === 'ios' ? 'padding' : 'height'}`, `className="flex-1"`). Inside it a `ScrollView` with `keyboardShouldPersistTaps="handled"` (exported constant `CREATE_SHEETS_SCROLL_TAPS_PERSIST`, same value as the T-0230 sheet pattern) whose `contentContainerStyle` centers the sheet (`flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 16`, keeping the old `p-4` look). A full-size backdrop `Pressable` (`absolute inset-0`, same `Close dialog` label) sits behind the sheet so a tap outside still closes the dialog; the sheet's own swallow-tap `Pressable` (inside each sheet root) keeps taps inside from closing. Visual look unchanged with the keyboard closed.
2. Mock store `createChannel`/`createGroup`: both now add a chat to the top of `chats` (with `unread: 0`, empty message list, `historyLoad: 'loaded'`) and return its id. Channels reuse the channel feed-row shape (`kind: 'group'`, `chatKind: 'channel'`, `subscriberCount`, `description`, `myRole: 'owner'`, `groupId`, channel General topic). Groups use `kind: 'group'`, id `mock-group-<n>`, `memberCount` = selected + me, `visibility`/`handle` when public, like the real store. Both trim and validate titles with the same sentences as the real store, and check a public handle against the mock directory (`createMockDirectoryApi().checkGroupHandle`), rejecting with `GroupsApiError(409, 'handle_taken', ...)` — the same code the sheet maps to "That handle was just taken. Try another."
3. New `apps/mobile/src/mock/contacts.ts` with Ana, Marco, Lena; loaded as a copy into `contacts` in the mock store's initial state.
4. Tests: `chat-store.test.ts` — contacts non-empty (Ana/Marco/Lena), channel create adds a chat and returns its id, channel create keeps a public handle, group create adds a chat and returns `mock-group-*` id, taken public handle rejects with `handle_taken`, blank titles reject like the real store. `new-chat-button.test.tsx` (existed): fixed the `react-native` mock for the new imports (`KeyboardAvoidingView`, `Platform`, `ScrollView`, `Share`) and added a test that the scroll persist constant is `'handled'`.

### Files changed
- `apps/mobile/src/components/chat/new-chat-button.tsx` (Modal restructure)
- `apps/mobile/src/components/chat/new-chat-button.test.tsx` (mock fix + persist-taps test)
- `apps/mobile/src/store/chat-store.ts` (mock creates + contacts)
- `apps/mobile/src/store/chat-store.test.ts` (6 new tests)
- `apps/mobile/src/mock/contacts.ts` (new)
- `work/T-0234-mobile-create-sheets-keyboard.md` (this report)

### Commands and results
- `pnpm install`: done (17.8s). It drifted `pnpm-lock.yaml` (2 transitive peer lines); I reverted it with `git checkout -- pnpm-lock.yaml` and re-ran the gate afterwards — still GATE PASS with a frozen install.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot chat-store new-chat-button`: 4 files, 48 tests, all passed.
- `pnpm gate` (final, after lockfile revert): `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/mobile`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.
- Single tests run while working: `chat-store.test.ts` (31 passed), `new-chat-button.test.tsx` (4 passed; the PascalCase casing warnings in output are pre-existing noise from the string-tag component stubs).

### Problems / deviations
- Spec asked for ScrollView content centering "with the same padding": kept `padding: 16` (= `p-4`) and added `flexGrow: 1` so centering holds for short sheets.
- `pnpm exec prettier --write` on `chat-store.test.ts` reported it fixed the file but `--check` still failed; fixed the one offending hunk by hand (a chained `.getState().createGroup` that prettier wants collapsed). Final `--check` passes.
- The lead checks emulator behavior; I verified markup/tests only, no emulator run here.

### Security checklist
- No secrets/tokens touched; no logging changes.
- No deletes/updates scoping issues (in-memory mock inserts only, prepended to `chats`).
- No caps/uniqueness rules changed; the `handle_taken` check reads the mock directory and throws before any insert.
- No permission checks involved; no new routes; no audit entries.

### Blocked / needs a decision
None.

### Round 2 (fix round, PREREVIEW findings 1-5)
- Finding 1 (must-fix): mock `createChannel` now returns `groupId`, matching `real-store.ts:3867`; `chat-store.test.ts` asserts the returned id matches `/^g-mock-/` and resolves one topic via `topicsOfGroup`.
- Finding 2 (must-fix): mock `createGroup` inserts a General topic row and returns `groupId`; test asserts one General topic under the returned id.
- Finding 3 (should-fix): the persist-taps test now asserts the rendered `ScrollView` markup contains `keyboardShouldPersistTaps="handled"`.
- Finding 4 (nit, fixed as touched line): mock channel topic visibility is `private` for private channels, `public` when a public handle is set; added a test for the private case.
- Finding 5 (nit, fixed as touched line): mock contacts are deep-copied per-object into initial state.
- No disagreements; no nits left unaddressed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot chat-store new-chat-button`: 4 files, 49 tests, all passed.
- `pnpm gate`: `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/mobile`, scope clean, `GATE PASS`.

## Review (written by Claude)

**Verdict:** Approved; clean after 1 auto round (0 nits).
- The sheets sit in a `KeyboardAvoidingView` plus `ScrollView`, and the backdrop is a sibling `Pressable`, so taps on a sheet cannot close it.
- The mock `createGroup` and `createChannel` match the real store's rules: blank title, 300-character description, `handle_taken` 409.
- The keyboard check on the emulator goes to the next QA run, and any finding becomes a follow-up.
