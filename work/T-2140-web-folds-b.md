---
id: T-2140
title: "Web (group members and topics, media, group settings, routines, integrations, tool detail, chat header, approvals): fold single-use component and helper files back into their only importer — fewer props interfaces, imports and exports; no behaviour or visual change"
status: merged
milestone: M5
branch: task/T-2140-web-folds-b
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2140: Fold single-use web files (group members and topics, media, group settings, routines, integrations, tool detail, chat header, approvals)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the code map total must go down. 400 lines is a soft limit, and files an earlier task split only for size may be merged back when that saves lines. Only a file over 800 lines must split. A component that only one file renders costs its own imports, an exported props interface and the props plumbing; folding it into its host removes those.

The lead listed these at `e4a868766`. Each mover has exactly one production importer, the host, and no test imports it. Each host stays at or below 650 lines.

| Mover (lines) | Host (lines) |
| --- | --- |
| `components/group-info/MemberRow.tsx` (180) | `components/GroupMembersSection.tsx` (164) |
| `components/group-info/TopicsSection.tsx` (263) | `components/group-info/GroupInfoRoot.tsx` (211) |
| `components/media/MediaRows.tsx` (140) | `components/media/MediaBody.tsx` (137) |
| `components/panels/GroupSettingSwitch.tsx` (137) | `components/GroupPanel.tsx` (450) |
| `components/routines/RoutineRow.tsx` (166) | `routes/RoutinesPage.tsx` (121) |
| `components/settings/EmailCard.tsx` (121) | `routes/IntegrationsPage.tsx` (203) |
| `components/settings/VoiceTranscriptionCard.tsx` (171) | `routes/IntegrationsPage.tsx` (203) |
| `components/tools/CodeBlock.tsx` (63) | `components/tools/ToolDetailPanel.tsx` (480) |
| `components/topic/TopicPeopleLine.tsx` (168) | `components/ChatHeader.tsx` (407) |
| `lib/useApprovalPolling.ts` (195) | `components/ApprovalCard.tsx` (252) |

All paths are under `apps/web/src/`.

### Steps
For each row, read both files.
1. **Fold:**
   - move the mover's code into the host, below the host's main export, and delete the mover;
   - a moved component becomes a non-exported function in the host;
   - keep its props type only if it still needs a name, and drop props the host can now pass more simply only when the result is identical;
   - remove `export`s nothing else uses.
2. **Duplicates.** Drop any declaration that becomes a duplicate (two copies of the same type, constant or helper).
3. **Skip** a fold when the result would read worse. For example, the host would mix two unrelated screens, or exceed 650 lines. Say why in the Report.

### Rules
- No behaviour change and no visual change: the same markup, class names, aria labels, focus order and effects.
- The diff only moves code and removes import/export/props plumbing. It changes no logic.
- Do not touch:
  - `apps/web/src/store/**`;
  - `apps/web/src/lib/api.ts`;
  - `apps/web/src/lib/api/**`.
- No new tests.
- Product lines go down by at least 60.

### Allowed files
- `apps/web/src/components/ApprovalCard.tsx`
- `apps/web/src/components/ChatHeader.tsx`
- `apps/web/src/components/group-info/GroupInfoRoot.tsx`
- `apps/web/src/components/group-info/MemberRow.tsx`
- `apps/web/src/components/group-info/TopicsSection.tsx`
- `apps/web/src/components/GroupMembersSection.tsx`
- `apps/web/src/components/GroupPanel.tsx`
- `apps/web/src/components/media/MediaBody.tsx`
- `apps/web/src/components/media/MediaRows.tsx`
- `apps/web/src/components/panels/GroupSettingSwitch.tsx`
- `apps/web/src/components/routines/RoutineRow.tsx`
- `apps/web/src/components/settings/EmailCard.tsx`
- `apps/web/src/components/settings/VoiceTranscriptionCard.tsx`
- `apps/web/src/components/tools/CodeBlock.tsx`
- `apps/web/src/components/tools/ToolDetailPanel.tsx`
- `apps/web/src/components/topic/TopicPeopleLine.tsx`
- `apps/web/src/lib/useApprovalPolling.ts`
- `apps/web/src/routes/IntegrationsPage.tsx`
- `apps/web/src/routes/RoutinesPage.tsx`
- `apps/web/src/components/group-info/TopicsSection.fixture.tsx` (added by the lead for the fix round)
- `apps/web/src/components/topic/TopicPeopleLine.fixture.tsx` (added by the lead for the fix round)
- `apps/web/src/components/AvatarUploader.tsx` (added by the lead for the fix round)
- `work/T-2140-web-folds-b.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down by at least 60.
- The Report lists each row: folded (lines saved) or skipped (why).
- **Lead check** (web mock): group info members and topics, shared media, group settings switches, /routines, /settings/integrations (email and voice cards), a tool's detail with code, the chat header people line in a topic, an approval card.

---

## Report (written by the worker when done)

### What I did

Folded each listed single-use file into its only production importer: moved the code below the
host's main export, made the moved components non-exported (except where a fixture requires the
name, see Notes), merged and de-duplicated imports, removed the old import line, and deleted the
mover.

Fix round (lead request): removed the two one-line re-export shims and pointed
`TopicsSection.fixture.tsx` at `./GroupInfoRoot` and `TopicPeopleLine.fixture.tsx` at
`../ChatHeader`; both mover files are now deleted. Item 2 of the fix round (the 2048 px / 1 MiB
comment) was skipped on the lead's instruction because this branch does not contain T-2139; no
`AvatarUploader.tsx` change was made.

Per-row result (`git diff --numstat` net, positive means the fold added lines):

| Row | Result |
| --- | --- |
| `group-info/MemberRow.tsx` → `GroupMembersSection.tsx` | folded, net **+2** (346-line host) |
| `group-info/TopicsSection.tsx` → `group-info/GroupInfoRoot.tsx` | folded, net **−2** (471-line host) |
| `media/MediaRows.tsx` → `media/MediaBody.tsx` | folded, net **−9** (276-line host) |
| `panels/GroupSettingSwitch.tsx` → `GroupPanel.tsx` | folded, net **−5** (582-line host) |
| `routines/RoutineRow.tsx` → `routes/RoutinesPage.tsx` | folded, net **−2** (285-line host) |
| `settings/EmailCard.tsx` + `settings/VoiceTranscriptionCard.tsx` → `routes/IntegrationsPage.tsx` | folded, net **−17** together (478-line host) |
| `tools/CodeBlock.tsx` → `tools/ToolDetailPanel.tsx` | folded, net **−3** (540-line host) |
| `topic/TopicPeopleLine.tsx` → `ChatHeader.tsx` | folded, net **+4** (578-line host) |
| `lib/useApprovalPolling.ts` → `ApprovalCard.tsx` | folded, net **−36** (411-line host) |

No row was skipped: every host ended at or below 650 lines and none stands over the 800-line hard
limit. The per-row numbers above are net line deltas; the two positive rows still follow the spec
(the mover's imports cost more than the fold saved) and the task as a whole meets its target.

In `ApprovalCard` the folded hook lost the options seam that no caller used (`VisibilitySource`,
`TimerSource`, `now`, `resetKey`): the card always called it with no arguments, so the rendered
result and polling cadence are identical. The id-change reset path is kept (`key`/`lastKey`).

### Checks run

- `pnpm install` — done (Done in 27s using pnpm v10.32.1).
- `pnpm gate` (fix round) — **GATE PASS**:
  `gate: 22 changed file(s) against main`; `PASS install (frozen)`, `PASS format`, `PASS lint`,
  `PASS typecheck`, `PASS effect`, `SKIP build @zilar/server (no server, package or manifest change)`,
  `PASS tests @zilar/web`; `scope: every changed file is inside the Allowed files`.
- Product lines: `git diff --numstat e4a868766..HEAD -- apps/web` → **1563 added, 1633 deleted,
  net −70** (acceptance: at least 60 lower). `size: no changed source file is over 800 lines`.
- No single test file was run individually: no test file imports a folded file, and the change is
  UI-only. The gate's `@zilar/web` test task ran.

### Notes for the lead

- `TopicsList` (in `GroupInfoRoot`) and `TopicPeopleLine` (in `ChatHeader`) stay `export`ed because
  `TopicsSection.fixture.tsx` and `TopicPeopleLine.fixture.tsx` import them; every other moved
  component is a local function. The two shim files from the first round are gone.
- In `ApprovalCard` the folded polling hook's unused test seams were dropped instead of moved, as
  noted above.
- Fix-round item 2 (restore the 2048 px / 1 MiB units comment) was skipped per the lead: T-2139 is
  not in this branch, and the matching code lives in `lib/background-image.ts` here (its comment is
  intact), not in `AvatarUploader.tsx`. `AvatarUploader.tsx` was not touched.
- No behaviour, markup, class names, aria labels, focus order or effects were changed; no tests
  were added, and no file outside the Allowed list was touched.


## Review (written by Claude)

Approved; the pre-review was clean (1 nit). Net −70: 10 single-use web files folded into their only importer (member row, topics section, media rows, group setting switch, routine row, email and voice cards, code block, topic people line, approval polling). The lead's fix round pointed the two Cosmos fixtures at the hosts and deleted the two shim files. The dropped `resetKey` option was unused on main: both callers pass only `request`.

**Web mock** (`:5257`, no page errors):
- all 25 routes render;
- Dev team group info lists the topics, and People and AIs lists the AIs, people and roles;
- Settings shows both switches;
- Shared media lists the media;
- `/settings/routines` lists Running and Paused;
- `/settings/integrations` shows the Email and Voice cards;
- a topic header shows its people line;
- Tools and routines lists tools with code blocks;
- the approval card in Dev team clears its buttons on Approve, the same as on main.

**Follow-up:** the comment at `ApprovalCard.tsx` ("The id or the reset key changed") still names the removed key.
