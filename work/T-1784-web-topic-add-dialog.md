---
id: T-1784
title: "Topic people W5 (web): In this topic gets one primary 'Add people or AIs' key opening a 440px Add dialog (People/AIs, search, In <group>, Your contacts/Your other AIs '+ joins <group>', Invite link + Copy), and a 'Tools and routines · N · M' row"
status: merged
milestone: M5
branch: task/T-1784-web-topic-add-dialog
model: auto
effort: default
depends_on: [T-1769]
estimate: 45 min
---

# T-1784: Web In this topic, with the Add dialog

## Spec (written by Claude, do not edit)

### Why
This is plan item **W5** (`docs/plan/topic-people.md` §3.4 and §4). The approved boards are `docs/design/mockups/topic-people/WebTopic.dc.html:84-133` (the In this topic panel) and `WebAdd.dc.html` (the Add dialog).
- **Today:** adding is split across two small pickers inside the People and AIs sections.
- **The board:** one primary key, and a dialog that can also pull in people and AIs who aren't in the group yet. The server does that in one step since T-1769, for group owners and admins.

### Facts (read by the lead on 2026-10-17)
- **The panel:** `apps/web/src/components/TopicPanel.tsx` (302 lines), with its ops in `apps/web/src/components/panels/topicPanelOps.ts` (278 lines).
  - It computes `addableMembers` (group members not in the topic, `:103-106`), `myAis` (the caller's AIs), `addableAis` (my AIs in the group but not in the topic, `:112-113`) and `isManager` (the caller's group role is owner or admin, `topicPanelOps.ts:47`).
  - `addMember(userId)` and `addAi(aiId)` call the store's `addTopicMember` and `addTopicAi` and refresh (`topicPanelOps.ts:140-170`).
- **The section pickers:** `TopicMembersSection` (`panels/TopicMembersSection.tsx`, 135 lines) and `TopicAisSection` (`panels/TopicAisSection.tsx`, 105 lines). Each has its own add picker (`pickerOpen`, `addableMembers`/`addableAis`, `addMember`/`addAi` props, used at `TopicPanel.tsx:163-211`).
- **Tools and routines:** today a "N tools in this topic" paragraph (`TopicPanel.tsx:226-230`), then `ToolsSection` and `RoutinesSection` always expanded (`:232-247`). `RoutinesSection` is `apps/web/src/components/tools/RoutinesSection.tsx` (334 lines).
- **Contacts:** `useChatSelector((s) => s.contacts)` gives `Contact { userId, name, jid, avatarUrl?, handle? }` (`packages/api-contract/src/contacts.ts:7-16`, `apps/web/src/store/store.ts:55`).
- **The group:** `info.members` (`userId`) and `info.ais` (`aiId`, `ownerId`).
- **Invite link:** `apps/web/src/components/InviteDialog.tsx` (63 lines) creates the link with `storeApi.getState().createInvite()` and copies it with `copyText` from `@/lib/clipboard`. Reuse that.
- **The server rule (T-1769):** adding someone not yet in the group needs a group owner or admin (`isManager`); anyone else gets 403.
- **The boards:**
  - `WebTopic.dc.html:90`: the `.primary` key "Add people or AIs" with a plus icon (`.primary` at `:38`, 40 px high), under the panel header;
  - `:106-113`: the "Tools and routines" row with `1 · 2` in mono;
  - `WebAdd.dc.html:40-67`: a `role="dialog"` 440 px panel at `top: 96px`, over a `rgba(0,0,0,.6)` scrim. It holds the header "Add to {topic}" with Close, the segmented People/AIs control (`.seg` at `:31-33`), the search well (40 px, "Name or @handle"), the "YOUR CONTACTS" rows (30 px avatar, name, a `+ joins {group}` mono tag, a light `Add` key) and the "Invite with a link" row with a dark `Copy` key.

### Steps
1. **A new `apps/web/src/components/panels/TopicAddDialog.tsx`,** drawn to `WebAdd.dc.html`. Escape and the scrim close it.
   - **People tab:**
     - "IN {GROUP}": `addableMembers`, each with Add;
     - then, **only when `isManager`**, "YOUR CONTACTS": contacts who aren't in the group, each with the `+ joins {group}` tag and Add.
   - **AIs tab:**
     - "IN {GROUP}": `addableAis`;
     - then, only when `isManager`, "YOUR OTHER AIS": `myAis` not in the group, each with `+ joins {group}`.
   - **The search** filters both tabs by name or handle, case-insensitively.
   - **Add** calls `addMember(userId)` or `addAi(aiId)` from the ops. Show a busy key while it runs. On success, the row turns into a muted "Added" tick. On failure it shows "Couldn't add".
   - **The bottom row:** "Invite with a link" and Copy, as in `InviteDialog.tsx`.
   - Empty lists show one muted line ("Everyone here is already in {topic}").
2. **`TopicPanel.tsx`:**
   - put the primary "Add people or AIs" key right under `TopicHeader`, opening the dialog;
   - remove the add pickers from `TopicMembersSection` and `TopicAisSection`: drop their picker props and trigger UI; their lists, remove actions and Leave stay;
   - replace the tools paragraph with a "Tools and routines · N · M" row (lucide `Wrench` in a key-icon, a mono count, and a chevron) that expands or collapses `ToolsSection` + `RoutinesSection`, collapsed by default.
   - **N** is `toolsCount`. **M** comes from a new optional `onCount?: (count: number) => void` prop on `RoutinesSection`, called when its list loads. Until it loads, show only N.
3. Keep every file at most 400 lines. If `TopicPanel.tsx` would pass 400, move the tools row into a new `apps/web/src/components/panels/TopicToolsRow.tsx`.
4. **A new Cosmos fixture,** `apps/web/src/components/panels/TopicAddDialog.fixture.tsx`, showing the People tab (with contacts) and the AIs tab, using static props or a small wrapper. No live store needed.
5. **No tests.**

### Allowed files
- `apps/web/src/components/panels/TopicAddDialog.tsx`
- `apps/web/src/components/panels/TopicAddDialog.fixture.tsx`
- `apps/web/src/components/panels/TopicToolsRow.tsx`
- `apps/web/src/components/TopicPanel.tsx`
- `apps/web/src/components/panels/topicPanelOps.ts`
- `apps/web/src/components/panels/TopicMembersSection.tsx`
- `apps/web/src/components/panels/TopicAisSection.tsx`
- `apps/web/src/components/tools/RoutinesSection.tsx`
- `work/T-1784-web-topic-add-dialog.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- In this topic shows one "Add people or AIs" key that opens the board's dialog.
- An owner or admin can add a contact or an AI who isn't in the group yet. Others only see "In {group}".
- The tools and routines collapse into one counted row.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

Implemented W5 (plan §3.4) exactly to the Allowed files:

- **`apps/web/src/components/panels/TopicAddDialog.tsx`** (new, 388 lines): the one Add dialog, drawn to `WebAdd.dc.html` — a 440 px panel at `top: 96px` over a `bg-black/60` scrim (Base UI primitives, so Escape and the scrim close it). Header "Add to {topic}" + Close; People/AIs `SegmentedControl`; the 40 px `well-surface` search ("Name or @handle"); the sections; the Invite row.
  - People: "IN {GROUP}" from `addableMembers`; "YOUR CONTACTS" (only `isManager`) from contacts not in the group, each with the mono `+ joins {group}` tag.
  - AIs: "IN {GROUP}" from `addableAis`; "YOUR OTHER AIS" (only `isManager`) from `myAis` not in the group, each with the tag.
  - Search filters both tabs case-insensitively by name (and handle for people).
  - Add calls `addMember`/`addAi`; the row shows "Adding…" while busy, a muted "Added" tick on success (kept after the list reload drops the row) and "Couldn't add" on failure.
  - A tab with no rows shows one muted line: "Everyone here is already in {topic}." (or "No one matches that search." when a search is active).
  - Invite row creates the link on open and copies it, as in `InviteDialog`.
  - `EntityAvatar` reads the store, which the fixture has no, so the rows use `Avatar` + `avatarIdentity` with the data the caller already holds.
- **`apps/web/src/components/panels/TopicToolsRow.tsx`** (new, 69 lines): the "Tools and routines · N · M" row (Wrench key-icon, mono count, chevron), collapsed by default, expanding `ToolsSection` + `RoutinesSection`. The two sections stay mounted while collapsed so the routine count is known. TopicPanel was under 400 lines either way, but the row's own state made it a clean extraction.
- **`apps/web/src/components/TopicPanel.tsx`**: the primary "Add people or AIs" key under `TopicHeader`; the dialog wired to `addMember`/`addAi`/`createInvite`; the tools paragraph + always-expanded sections replaced by `TopicToolsRow`. The Add dialog is a child of the `Sheet` (like the confirms), so Escape closes only the topmost overlay.
- **`apps/web/src/components/panels/topicPanelOps.ts`**: dropped the two picker states; added `addDialogOpen`; `addMember`/`addAi` now just `reloadAfter()`; added a stable `createInvite` for the dialog.
- **`apps/web/src/components/panels/TopicMembersSection.tsx`** / **`TopicAisSection.tsx`**: removed the add pickers and their props/UI; lists, remove actions and Leave are unchanged.
- **`apps/web/src/components/tools/RoutinesSection.tsx`**: new optional `onCount?: (count: number) => void`, called once its list is ready.
- **`apps/web/src/components/panels/TopicAddDialog.fixture.tsx`** (new): two Cosmos entries, People (with in-group members and contacts) and AIs, on static props — no store.

### Checks run

- `pnpm gate` from the repo root, first run: `FAIL format` on `TopicAddDialog.tsx`. Ran `pnpm exec prettier --write` on that file; second run: `FAIL typecheck` (the row's `useAction` error type was `never`, changed to `ApiFailure`). Third run, final:

```
gate: 9 changed file(s) against main
PASS  install (frozen)  (2.7s)
PASS  format  (0.8s)
PASS  lint  (1.0s)
PASS  typecheck  (4.4s)
PASS  effect  (1.6s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

- No per-file tests: the spec says "No tests", and the change is UI.

### Notes for the lead

- Two rows read only when the dialog's section renders: the search filters the merged rows. The add handlers are the ops' one-call effects; no new API surface.
- `TopicAddDialog` takes an optional `initialTab` (default `'people'`) so the fixture can capture the AIs tab; production never passes it.
- Follow-up outside my Allowed files: after removing the pickers, `PickerToggle` (`TopicListNotices.tsx`) and `AddMemberButton` / `AddAiButton` (`TopicActionButtons.tsx`) are now unreferenced exports. I left them because those files are not in scope; a later task can delete them.
- `TopicToolsRow` renders both sections mounted (hidden when collapsed) so M is known before expanding, as the board shows the count collapsed.

### Round 2 (fix review)

- **Finding 1 (should-fix): fixed.** A failed Add row is now retryable instead of a dead label. `AddKey` renders "Couldn't add" plus an outline **Retry** key while the outcome is `failed` (and shows "Retrying…" while the retry runs); Retry re-runs the same `useAction`, so a transient failure (flaky network, 429) no longer forces the user to close and reopen the dialog. Only `apps/web/src/components/panels/TopicAddDialog.tsx` changed (now 397 lines, under the 400 cap); its `AddKey` doc comment was updated to match.
- **Tests added: none.** The Spec says "No tests", AGENTS.md says "UI code gets no tests", and the task's Allowed files name no test file — a new test path would fail the gate's scope check. The behaviour change is UI and is covered by the lead's smoke / live checks.
- **Findings 2 and 3 (both nits): left as-is** per the round rules ("do not touch nits unless they are in a line you already change"); neither involves a line this round changed.
- **Single test run:** none — no test file was touched (spec "No tests").
- **`pnpm gate`** from the repo root:

```
gate: 9 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (1.6s)
PASS  lint  (1.0s)
PASS  typecheck  (3.5s)
PASS  effect  (0.6s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Round 3 (fix review)

- **Finding 1 (should-fix): already fixed at HEAD; re-verified, no code change.** `PREREVIEW.md` names HEAD `a4035eb`, but the branch is now at `ac8ee7e4f` and already carries round 2's fix, commit `82ad550be` ("T-1784: fix finding 1 - make a failed Add row retryable"). `AddKey` no longer renders a dead label: for `outcome === 'failed'` it renders "Couldn't add" plus an outline **Retry** key (`TopicAddDialog.tsx:63-74`) that re-runs the same `useAction`. I re-checked the retry path: `run` only drops a call while the action is still `waiting` (`packages/client-core/src/use-action.ts:98-106`), so a click after a failure starts a fresh call, and a successful retry flips the row to "Added" — a transient failure (flaky network, 429) no longer forces the user to close and reopen the dialog. Nothing was left to change, so I did not re-edit the file.
- **Findings 2 and 3 (both nits): untouched** — the round rules say not to touch nits outside a line this round changes, and neither is.
- **Tests added: none.** The Spec says "No tests", AGENTS.md says "UI code gets no tests", and no test file is in Allowed files — a new path would fail the gate's scope check.
- **Single test run:** none — no test file was touched (spec "No tests").
- **`pnpm gate`** from the repo root:

```
gate: 9 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (0.9s)
PASS  lint  (0.8s)
PASS  typecheck  (1.0s)
PASS  effect  (0.6s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Lead round

- **Item 1 — a failed Add can be retried (`TopicAddDialog.tsx`):** the failed row now keeps the Add key and shows the muted "Couldn't add" text beside it; a tap clears the failure, so the busy Add key returns and the same `useAction` re-runs. Commit `9038278c2`.
- **Item 2 — outside-group sections wait for the group info (`TopicPanel.tsx`):** `contactsNotInGroup` and `otherAis` are empty until `info !== undefined`, so "YOUR CONTACTS" / "YOUR OTHER AIS" stay hidden while the group info loads and no group member gets the "+ joins" tag. `isManager` is left untouched, so a caller who is loading is not re-labelled a non-manager. Commit `529562ce5`.
- **Item 3 — tools and routines load only when opened (`TopicToolsRow.tsx`):** `ToolsSection` and `RoutinesSection` mount only when the row is open, so a closed row makes no list reads. Commit `eb4d62513`.
- **Tests added: none** — Spec says "No tests", AGENTS.md says UI gets no tests.
- **`pnpm gate`** from the repo root after the three item commits:

```
gate: 9 changed file(s) against main
PASS  install (frozen)  (2.3s)
PASS  format  (1.2s)
PASS  lint  (2.0s)
PASS  typecheck  (4.2s)
PASS  effect  (0.7s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `73f235b7c`, after two autopilot rounds and one lead round.
- **Cosmos `TopicAddDialog` (People) vs `WebAdd.dc.html`** match:
  - the 440 px dialog with "Add to Financial" and Close;
  - the People/AIs control and the search well;
  - "YOUR CONTACTS" rows with `+ joins ai test` and light Add keys;
  - the Invite row with Copy.
  - The "IN AI TEST" section above the contacts is in the spec.
- **`TopicPanel`:** one primary "Add people or AIs" key, and the section pickers are gone.
- **The tools row:** "Tools and routines" is collapsed, and its sections mount only when it's open.
- **The lead round:**
  - a failed Add can be retried;
  - the outside-group sections wait for the group info.

