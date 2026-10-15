---
id: T-1534
title: "AI work in topics, step 6b (web): remove the topic task strip (kind, status, owner chips); the topic link becomes an editable row in the topic info panel; the panel gets 'Mark as done' / 'Reopen' (PATCH done)"
status: merged
milestone: M5
branch: task/T-1534-web-remove-task-strip
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1534: Web drops the task strip

## Spec (written by Claude, do not edit)

### Why
The approved "AI work in topics" design (`docs/design/mockups/ai-work/README.md`) removes the hand-set kind, the five statuses, the single owner AI and the task strip under the topic header. A topic's state comes from what its AIs do (T-1532 shows it).

Julio also decided on 2026-10-15:
- the topic **link** stays, as an editable row in the topic's info panel;
- a person can mark a topic **done** (T-1521, `PATCH done`).

**The lead merges this only after T-1529**, which moves AI following off the owner.

### Facts (the lead read them on main, 2026-10-15)
- **The strip:** `apps/web/src/routes/ChatView.tsx:260` renders `{chat.topic !== undefined && <TaskStrip chat={chat} />}` (366 lines).
  - `apps/web/src/components/TaskStrip.tsx` (191 lines) uses `StatusMenu.tsx` (56), `OwnerMenu.tsx` (98) and `LinkEditor.tsx` (112), all in `apps/web/src/components/topic/`, plus `topic/stripModel.ts` (95 lines: `typeLabel`, `ownerLabel`, `httpsUrl`, `linkText` and `ownerIdFor`, used only by those files).
  - `LinkEditor` validates https and saves through `storeApi.getState().patchTopic(chat.id, { linkUrl, linkLabel })`; the label is cut to 40 characters.
- **The topic info panel:** `apps/web/src/components/TopicPanel.tsx` (266 lines) is a `Sheet` with `TopicHeader`, then Members, AIs, rules, roles, tools, routines, Pins, and `TopicDangerZone` (`:134-240`).
- **The patch input:** `PatchTopicInput` in `apps/web/src/lib/api/topics.ts:56-68` has no `done`; the contract's `PatchTopicPayload` has `done` (T-1521).
- **The topic fields:** `TopicInfo` has `linkUrl`, `linkLabel` and `doneAt`.

### Steps
1. **`ChatView.tsx`:** remove the `TaskStrip` line and import.
2. **Delete** `TaskStrip.tsx`, `topic/StatusMenu.tsx`, `topic/OwnerMenu.tsx` and `topic/LinkEditor.tsx`. Trim `topic/stripModel.ts` to `httpsUrl` and `linkText`, or move those two into the new row and delete the file.
3. **New `apps/web/src/components/topic/TopicLinkRow.tsx`, in `TopicPanel.tsx` after the members section:**
   - **with a link:** a `ListRow` with the `Link` icon tile, the label (or the host) as the title opening the URL in a new tab, and an Edit `IconButton` (pencil, "Edit topic link");
   - **without one:** an "Add a link" row;
   - **editing:** an inline form with URL and Label `TextInput`s, Save and Cancel, and Remove when a link exists. It keeps the https check ("Link must be an https URL."), the 40-character label, and the same `patchTopic` call.
4. **Done:** `PatchTopicInput` gains `done?: boolean`. `TopicPanel.tsx` gets a row:
   - "Mark as done" (`CheckCircle2`) when `doneAt` is null;
   - "Reopen" (`RotateCcw`) when it is set.
   
   Each calls `patchTopic(chat.id, { done })`, then refreshes the chats so the sidebar mark updates. Any member who can see the topic may use it.
5. **Keep** everything under 400 lines. Remove any other import of the deleted files (typecheck will list them).

### Not in scope
- the phone (step 7);
- the server and contract (the old fields stay until step 8);
- the composer status line.

### Tests
None (UI).

### Allowed files
- `apps/web/src/routes/ChatView.tsx`
- `apps/web/src/components/TaskStrip.tsx` (delete)
- `apps/web/src/components/topic/StatusMenu.tsx` (delete)
- `apps/web/src/components/topic/OwnerMenu.tsx` (delete)
- `apps/web/src/components/topic/LinkEditor.tsx` (delete)
- `apps/web/src/components/topic/stripModel.ts`
- `apps/web/src/components/topic/TopicLinkRow.tsx` (new)
- `apps/web/src/components/TopicPanel.tsx`
- `apps/web/src/lib/api/topics.ts`
- any file typecheck names for an import of a deleted file (list them in the Report)
- `work/T-1534-web-remove-task-strip.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Web mock:** a topic shows no strip under the header.
- **Its info panel** has the link row (add, edit and remove work in the mock) and "Mark as done", which flips to "Reopen" and puts the green check on the sidebar row.
- 0 page errors.

---

## Report (written by the worker when done)

### What I did

- **`ChatView.tsx`:** removed the `TaskStrip` import and the `{chat.topic !== undefined && <TaskStrip chat={chat} />}` line (nothing else touched).
- **Deleted** `apps/web/src/components/TaskStrip.tsx`,
  `apps/web/src/components/topic/{StatusMenu,OwnerMenu,LinkEditor}.tsx` and
  `apps/web/src/components/topic/stripModel.ts` (I moved the two helpers the
  new row needs into the new file and deleted `stripModel.ts`, the second option
  the spec offered).
- **New `apps/web/src/components/topic/TopicLinkRow.tsx`:** the link as an
  editable row.
  - With a link: a `ListRow` (lucide `Link` tile) whose title is the label, or the
    host, opening the URL in a new tab, plus a pencil `IconButton`
    ("Edit topic link") next to it (outside the row: a button cannot hold a
    button).
  - Without one: an "Add a link" `ListRow`.
  - Editing: an inline bordered form with URL and Label `TextInput`s, Save,
    Cancel and Remove (only with an existing link). It keeps the https check
    ("Link must be an https URL."), the 40-character label (`maxLength` and a
    `slice(0, 40)`) and the same `patchTopic(chat.id, { linkUrl, linkLabel })`
    call. Save/Remove failures keep the form open and show the fixed sentence
    "Could not save. Try again." in the panel's inline error.
- **`TopicPanel.tsx`:** a new "Topic" section right after the members section,
  holding the link row and the done row: "Mark as done" (`CheckCircle2`) while
  `topic.doneAt === null`, "Reopen" (`RotateCcw`) when it is set. Both call
  `patchTopic(chat.id, { done })` and then `refreshChats()` so the sidebar mark
  updates; failures show "Could not update the topic." inline. No permission
  gate: any member who can see the topic may use it.
- **`apps/web/src/lib/api/topics.ts`:** `PatchTopicInput` gained `done?: boolean`
  (the contract's `PatchTopicPayload` already carries it, T-1521).
- Files typecheck named for an import of a deleted file: **none**.
- `TopicPanel.tsx` is ~302 lines and `TopicLinkRow.tsx` is 182; both inside the
  400-line limit.

### Checks run

- Single tests: **none** — the spec says "Tests: None (UI)".
- `pnpm install`: done, clean.
- `pnpm gate` (from the repo root, base `main`, 10 changed files):
  ```
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.0s)
  PASS  lint  (1.2s)
  PASS  typecheck  (3.4s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/web  (5.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- I ran no browser/mock session (starting a dev server is a background job the
  safety rules forbid), so the two mock acceptance points ("no strip under the
  header", "add/edit/remove the link and Mark as done flips to Reopen") are
  **not** verified by me; they are for Julio's live check.
- The `ListRow` kit renders a `<button>` and takes no `target`, so the link title
  opens the URL with `window.open(href, '_blank', 'noopener,noreferrer')` from
  the row's own click (same effect as an `<a target="_blank">`). The Edit pencil
  sits outside the row because a nested button is invalid HTML.
- The done row lives in `TopicPanel.tsx`; its action could not go into
  `useTopicPanelOps` because that file is not under Allowed files. It reuses the
  exported `storeCall` from that same module plus `failInline`.
- The store's `patchTopic` already repaints the topic row from the server's
  answer; the extra `refreshChats()` is what the spec asks for the sidebar mark.
  The web sidebar does not yet render any `doneAt` mark in this worktree (no
  `doneAt` usage anywhere under `apps/web/src`), so that mark must come from
  T-1532/step 8.
- Nothing was pushed, merged or switched; only this branch was committed.

## Review (written by Claude)

**Approved and merged** after T-1529, as the spec required.

- **Pre-review:** clean.
- **Headless web mock** (the Checkout topic):
  - no strip words ("In progress", "Owner:") under the header;
  - the info panel's "Topic" section shows the link row "PR #42" with "Edit topic link", then "Mark as done";
  - an `http://` link is refused with "Link must be an https URL.";
  - saving `https://example.com/pr/43` as "PR #43" updates the row;
  - "Mark as done" flips to "Reopen";
  - 0 page errors.
- **The sidebar row showed no marks** on this branch because it predates T-1532. After the merge, Checkout keeps its working and waiting marks (the check shows only when nobody works or waits).
- **Deleted:** `TaskStrip`, `StatusMenu`, `OwnerMenu`, `LinkEditor` and `stripModel` (552 lines). The web no longer sets kind, status or owner. The server fields stay until step 8.

