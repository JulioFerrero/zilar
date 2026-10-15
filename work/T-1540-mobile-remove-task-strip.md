---
id: T-1540
title: "AI work in topics, step 7b (phone; twin of web T-1534): remove the topic task strip (kind, status, owner chips); the topic link becomes an editable row in the topic info sheet; the sheet gets 'Mark as done' / 'Reopen' (PATCH done)"
status: merged
milestone: M5
branch: task/T-1540-mobile-remove-task-strip
model: auto
effort: default
depends_on: [T-1529]
estimate: 50 min
---

# T-1540: Phone drops the task strip

## Spec (written by Claude, do not edit)

### Why
The approved "AI work in topics" design (`docs/design/mockups/ai-work/README.md`) removes the hand-set kind, the five statuses, the single owner AI and the task strip under the topic header. Web does this in T-1534.

Julio decided on 2026-10-15:
- the topic **link** stays, as an editable row in the topic's info sheet;
- a person can mark a topic **done** (`PATCH done`, T-1521).

**The lead merges this only after T-1529**, which moves AI following off the owner.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/mobile/src/app/chat/[id].tsx` (262 lines):**
  - renders `<TaskStrip …/>` at `:185-239`, with the link save logic inline (`:226-238`: the https check "Link must be an https URL.", the label cut to 40 characters, `patch({ linkUrl, linkLabel })`);
  - it reads the strip state from `useChatScreen()` (`:75-89`).
- **`apps/mobile/src/components/chat/task-strip.tsx` (248 lines):** the strip, deleted by this task.
- **`apps/mobile/src/components/chat/use-chat-screen.ts` (362 lines):**
  - the strip state: `statusOpen`, `ownerOpen`, `linkOpen`, `linkUrl`, `linkLabel` and `stripError` (`:75-80`);
  - `ownerCandidates` (`:219-226`), `patch` (`:228-235`) and `chooseStatus` (`:237-243`);
  - the returned fields (`:319-332`).
- **`apps/mobile/src/components/chat/topic-info-sheet.tsx` (349 lines):** a `BottomSheet`:
  - the header (picture, name, group), then Members, AIs, Roles and others;
  - Leave and Archive at the end (`:323-345`);
  - it is mounted through `apps/mobile/src/components/chat/topic-info-host.tsx` (123 lines), which gets `screen`.
- **`PatchTopicInput`** (`apps/mobile/src/lib/topics-api.ts:83-96`) has no `done`; the contract has `done` (T-1521).
- **`httpsTopicUrl`** is used for the link check; `TopicInfo` has `linkUrl`, `linkLabel` and `doneAt`.

### Steps
1. **`[id].tsx`:** remove the `TaskStrip` block and its import, and the strip fields it destructures. Keep the file working for legacy group rows and channels.
2. **Delete `task-strip.tsx`.** In `use-chat-screen.ts`, remove the status and owner state and `chooseStatus`/`ownerCandidates`. Keep `patch` (the new rows use it) and an error string for the sheet. Remove any import typecheck flags.
3. **New `apps/mobile/src/components/chat/topic-link-row.tsx`:**
   - **with a link:** a row with a `Link` icon tile, the label (or the host) opening the URL with `Linking.openURL`, and an Edit `IconButton` (pencil, "Edit topic link");
   - **without one:** an "Add a link" row;
   - **editing:** inline URL and Label `TextInput`s, Save and Cancel, and Remove when a link exists;
   - it keeps the same https check, the 40-character label, and `patch({ linkUrl, linkLabel })`.
4. **New `apps/mobile/src/components/chat/topic-done-row.tsx`:**
   - "Mark as done" (`CheckCircle2`) when `doneAt` is null; "Reopen" (`RotateCcw`) when it is set;
   - it calls `patch({ done: true | false })`;
   - `PatchTopicInput` gains `done?: boolean`.
5. **`topic-info-sheet.tsx`:** render the link row after the header and the done row before Leave/Archive, each in one or two lines. It stays under 400 lines; pass what the rows need from `topic-info-host.tsx`.
6. **Every file stays under 400 lines.**

### Not in scope
- web (T-1534);
- the server and contract (the old fields stay until step 8);
- the activity marks (T-1539).

### Tests
None (UI).

### Allowed files
- `apps/mobile/src/app/chat/[id].tsx`
- `apps/mobile/src/components/chat/task-strip.tsx` (delete)
- `apps/mobile/src/components/chat/use-chat-screen.ts`
- `apps/mobile/src/components/chat/topic-link-row.tsx` (new)
- `apps/mobile/src/components/chat/topic-done-row.tsx` (new)
- `apps/mobile/src/components/chat/topic-info-sheet.tsx`
- `apps/mobile/src/components/chat/topic-info-host.tsx`
- `apps/mobile/src/lib/topics-api.ts`
- any file typecheck names for an import of the deleted file or removed fields (list them in the Report)
- `work/T-1540-mobile-remove-task-strip.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Phone mock:** the Checkout topic shows no strip under the header.
- **Its info sheet** has the link row ("PR #42"; edit and remove work) and "Mark as done", which flips to "Reopen".

---

## Report (written by the worker when done)

### What I did

- **`app/chat/[id].tsx`:** removed the `<TaskStrip …/>` block and its import, and
  the strip fields it destructured (`statusOpen`, `chooseStatus`, `ownerOpen`,
  `ownerCandidates`, `linkOpen`, `linkUrl/linkLabel`, `stripError`, `patch`). The
  `httpsTopicUrl` import went with them. The legacy-group, channel and topic
  branches are otherwise untouched.
- **Deleted `components/chat/task-strip.tsx`.**
- **`components/chat/use-chat-screen.ts`:** removed `statusOpen`/`ownerOpen`/
  `linkOpen`/`linkUrl`/`linkLabel`, `ownerCandidates` and `chooseStatus`, and
  dropped the now-unused `TopicStatus` type import. Kept `patch` (the rows use
  it) and the error string, renamed `stripError`/`setStripError` →
  `topicError`/`setTopicError` (the sheet's topic-row error line). Returned fields
  updated.
- **New `components/chat/topic-link-row.tsx` (148 lines):** the link as an
  editable row.
  - With a link: a `ListRow` with a lucide `Link` `IconTile`; the title is the
    label (or host) and opens the URL with `Linking.openURL`; an `IconButton`
    (pencil, "Edit topic link") sits beside the row (a button cannot hold a
    button).
  - Without one: an "Add a link" `ListRow`.
  - Editing: an inline bordered form with URL and Label `TextField`s, Save,
    Cancel and Remove (only when a link exists). It keeps the https check
    ("Link must be an https URL."), the 40-character label (`maxLength` and
    `slice(0, 40)`) and the same `patch({ linkUrl, linkLabel })` call.
- **New `components/chat/topic-done-row.tsx` (39 lines):** "Mark as done"
  (`CheckCircle2`) while `doneAt === null`, "Reopen" (`RotateCcw`) when it is set;
  either calls `patch({ done: !done })`. No permission gate (any member who can
  see the topic may flip it, per the spec).
- **`components/chat/topic-info-sheet.tsx` (371 lines):** the link row renders
  right after the header, the done row right before Leave/Archive, and the shared
  `patchError` line sits under the link row. New props `patch`, `patchError`,
  `onPatchError` threaded through.
- **`components/chat/topic-info-host.tsx`:** passes `patch={screen.patch}`,
  `patchError={screen.topicError}`, `onPatchError={screen.setTopicError}`.
- **`lib/topics-api.ts`:** `PatchTopicInput` gained `done?: boolean` (the
  contract's `PatchTopicPayload` already carries it, T-1521).
- **Files typecheck named for an import of the deleted file or removed fields:
  none.** The only other references to `task-strip`/`TaskStrip` are in `docs/`
  and other task files, which are out of scope.

### Checks run

- Single tests: **none** — the spec says "Tests: None (UI)".
- `pnpm install`: done, clean.
- `pnpm gate` (from the repo root, base `main`, 9 changed files):
  ```
  PASS  install (frozen)  (2.2s)
  PASS  format  (1.0s)
  PASS  lint  (2.1s)
  PASS  typecheck  (5.0s)
  PASS  effect  (2.0s)
  PASS  tests @zilar/mobile  (4.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- I ran no phone/mock session (starting a dev server is a background job the
  safety rules forbid), so the two acceptance points ("no strip under the
  header", "the info sheet's link row edits/removes and Mark as done flips to
  Reopen") are **not** verified by me; they are for Julio's live check.
- The spec said "keep an error string for the sheet" and the sheet already had an
  `error` prop for Leave/Archive (`infoError`). I kept those separate: the link
  and done rows report through the store's `patch` into `topicError`, rendered as
  its own line under the link row. So the sheet can show two error lines if both
  a leave/archive failure and a patch failure happen at once; in practice only
  one action is in flight at a time.
- The store's `patchTopic` already repaints the topic row from the server's
  answer (including `doneAt`), so no extra chats refresh is needed for the phone
  sidebar mark (unlike the web's `refreshChats()`).
- `lib/topics.ts` still exports `topicStatusLabel` and `topicOwnerLabel` (used
  only by the deleted strip). That file is not in Allowed files, so I left them;
  a later cleanup task can drop them.
- Nothing was pushed, merged or switched; only this branch was committed.

## Review (written by Claude)

**Approved and merged** after T-1529, as the spec required.

- **Pre-review:** clean, with 2 nits and 1 follow-up.
- **Phone smoke** (`/chat/t-devteam-bug@rooms.zilar.test`, mock): PASS. The topic shows no strip under the header (no BUG, In progress, Owner or PR chips). The "AIs here" key comes from T-1539, merged after this branch was cut.
- **The new rows** were read in the code (the smoke cannot open the info sheet):
  - the link row keeps the https check, the 40-character label and `patch({ linkUrl, linkLabel })`;
  - the done row sends `patch({ done })` and flips between "Mark as done" and "Reopen".
- **Nits, accepted:**
  - a validation error survives Cancel;
  - one shared error line sits under the link row.
- **Follow-up:** `topicTypeLabel`, `topicOwnerLabel` and now `topicStatusLabel` in `apps/mobile/src/lib/topics.ts` are dead. They join the phone dead-code task.
