---
id: T-1838
title: "Phone 'In this topic' sheet follows PhonePeople.dc.html: a Tools and routines row after People that opens a topic-scoped tools page; no 'Roles are only available on private topics.' line on public topics; Archive is a red row in its own group instead of a floating key"
status: merged
milestone: M5
branch: task/T-1838-phone-topic-sheet-board
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1838: The phone topic sheet follows its board

## Spec (written by Claude, do not edit)

### Why
**The lead's emulator check of main (mock build, "Checkout button hidden on Safari", 2026-10-17)** found three gaps against `docs/design/mockups/topic-people/PhonePeople.dc.html` (README: the sheet has "**Tools and routines** for this topic ('1 · 2')"):
1. **The Tools and routines row is missing.** The board puts it after People (`PhonePeople.dc.html:82-89`).
2. **A public topic shows "Roles are only available on private topics."** It's a line about a feature that isn't there.
3. **Archive is a red key floating at the bottom right,** outside every group.

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/components/chat/topic-info-sheet.tsx`** (348 lines):
  - the People `InfoGroup` (`:267-290`);
  - then `TopicLinkRow`, `TopicInfoRoles` (`:309-322`), `TopicDoneRow`, `TopicMuteLeave`;
  - then, when `canArchive`, a `flex-row justify-end` `Button variant="destructive"` reading "Archive" (`:330-340`).
- **`apps/mobile/src/components/chat/topic-info-roles.tsx:97-103`:** for `visibility !== 'private'` it returns that one muted line.
- **`apps/mobile/src/components/group-info/info-row.tsx:11-26`:** `InfoRow {icon, label, count?, danger?, onPress}` draws a tile, the label, an optional mono count and a chevron. `danger` is the red row with no tile and no chevron.
- **`apps/mobile/src/components/chat/topic-info-host.tsx`** (202 lines) mounts `TopicInfoSheet` with callbacks that close the sheet first (`onAdd`, `onOpenAiMemory`, `:134-151`). The group id is `screen.chatGroupId` (`:100`), and `chat.topic.id` is the topic id.
- **`apps/mobile/src/components/group-info/tools-page.tsx`** (116 lines):
  - `ToolsPage({ groupId, onBack })` loads `api.listGroupTools(groupId)` and `api.listGroupRoutines(groupId)`, where a 404 or a bad response reads as empty (`:33-48`);
  - it draws its own header with Back and "Tools and routines" (`:93-101`).
- **`apps/mobile/src/lib/tools-api.ts`** (232 lines):
  - the `ToolsApi` interface (`:117-120`) and its implementation (`:190-195`, `client.tools.listForGroup` / `client.routines.listForGroup`);
  - the contract already has `client.tools.listForTopic` (`GET /topics/:id/tools`, `packages/api-contract/src/tools.ts:131-134`) and `client.routines.listForTopic` (`GET /topics/:id/routines`, `packages/api-contract/src/routines.ts:62-65`);
  - `ToolsApi` is implemented only in this file.
- **Navigation:** `goBackOrHome(router)` is in `apps/mobile/src/lib/navigation.ts:10`, and screens wrap in `RequireAuth` (`app/group-info/[id].tsx:6`). Expo Router picks up a new route file on its own.
- **The mock backend:**
  - `packages/mock-backend/src/domains/routines/routes.ts:19-29` serves `groups/:id/routines` only;
  - its routines carry `topicId` (`routines/seed.ts:11,31`);
  - mock topic tools already exist (`domains/tools/routes.ts:28`).

### Steps
1. **`tools-api.ts`:** add `listTopicTools(topicId)` and `listTopicRoutines(topicId)` to the interface and the implementation, the same way as the group calls.
2. **`tools-page.tsx`:** add an optional `topicId?: string` prop. When it is set, load with the topic calls (same empty-on-404 handling); otherwise keep the group calls. The manager check stays on `groupId`.
3. **New route `apps/mobile/src/app/topic-tools/[id].tsx`:** `id` is the topic id and the `group` search param is the group id. It renders `<RequireAuth>` around `<ToolsPage groupId={group} topicId={id} onBack={() => goBackOrHome(router)} />`.
4. **`topic-info-sheet.tsx`:**
   - add `onOpenTools?: () => void`. When it is set, draw an `InfoGroup` with one `InfoRow icon={Wrench} label="Tools and routines"` right after the People section;
   - replace the floating Archive key with an `InfoGroup` holding `InfoRow danger icon={Archive} label="Archive topic"` (disabled while `busy`), placed after `TopicMuteLeave`.
5. **`topic-info-host.tsx`:** pass `onOpenTools` only when `screen.chatGroupId` is defined. It closes the sheet, then runs `router.push({ pathname: '/topic-tools/[id]', params: { id: chat.topic.id, group: screen.chatGroupId } })`.
6. **`topic-info-roles.tsx`:** return `null` instead of the notice for non-private topics.
7. **Mock:** in `routines/routes.ts`, also serve `GET topics/:id/routines`, filtering on `routine.topicId === id`.
8. **No tests** (UI and listing). Every file stays at most 400 lines.

### Allowed files
- `apps/mobile/src/lib/tools-api.ts`
- `apps/mobile/src/components/group-info/tools-page.tsx`
- `apps/mobile/src/app/topic-tools/[id].tsx`
- `apps/mobile/src/components/chat/topic-info-sheet.tsx`
- `apps/mobile/src/components/chat/topic-info-host.tsx`
- `apps/mobile/src/components/chat/topic-info-roles.tsx`
- `packages/mock-backend/src/domains/routines/routes.ts`
- `work/T-1838-phone-topic-sheet-board.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **In the mock build,** the sheet of "Checkout button hidden on Safari" shows a Tools and routines row after People. It opens a page listing that topic's tools and routines, and Back returns to the chat.
- **On a public topic,** no roles line shows.
- **Archive topic** is a red row in its own group.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- **`apps/mobile/src/lib/tools-api.ts`:** added `listTopicTools(topicId)` and `listTopicRoutines(topicId)` to `ToolsApi` and the `createToolsApi` implementation, calling `client.tools.listForTopic` / `client.routines.listForTopic`.
- **`apps/mobile/src/components/group-info/tools-page.tsx`:** `ToolsPage` takes an optional `topicId`. The loaders (`loadTools`, `loadRoutines`) use the topic calls when it is set and the group calls otherwise, keeping the same empty-on-404/invalid-response handling; the query deps include `topicId`. The manager bit still reads `groupDetail(groupId)`.
- **`apps/mobile/src/app/topic-tools/[id].tsx` (new):** route with `RequireAuth`, `id` as the topic id, `group` as the group id, rendering `ToolsPage groupId={group} topicId={id}` with `onBack={() => goBackOrHome(router)}`.
- **`apps/mobile/src/components/chat/topic-info-sheet.tsx`:** new optional `onOpenTools`. When set, an `InfoGroup` with `InfoRow icon={Wrench} label="Tools and routines"` draws right after the People section. The floating destructive `Button` is gone: `canArchive` now draws an `InfoGroup` with `InfoRow danger icon={Archive} label="Archive topic"` after `TopicMuteLeave`, and its press is a no-op while `busy`.
- **`apps/mobile/src/components/chat/topic-info-host.tsx`:** captures `screen.chatGroupId` and `chat.topic.id`; when both exist it passes `onOpenTools`, which closes the sheet and pushes `/topic-tools/[id]` with `{ id, group }`. Otherwise `onOpenTools` is `undefined` and the row is not drawn.
- **`apps/mobile/src/components/chat/topic-info-roles.tsx`:** non-private topics now return `null` instead of the "Roles are only available on private topics." line.
- **`packages/mock-backend/src/domains/routines/routes.ts`:** `handleRoutines` also serves `GET topics/:id/routines`, filtering non-deleted routines on `routine.topicId === id` (topic tools were already served by `domains/tools/routes.ts`).

### Checks run
- `pnpm install --frozen-lockfile`: Done in 10.5s.
- `pnpm gate` (first run): `FAIL format` — Prettier flagged `apps/mobile/src/app/topic-tools/[id].tsx` and `apps/mobile/src/components/group-info/tools-page.tsx`.
- `pnpm exec prettier --write` on those two files only: both rewritten.
- `pnpm gate` (second run): `exit=0`, summary:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.7s)
  PASS  lint  (1.1s)
  PASS  typecheck  (5.5s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/mobile  (2.6s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No separate single-file test run: the spec says no tests, and there are no test files near these screens (the gate's mobile run covered the package's nearby tests; mock-backend has none near the routines routes).

### Notes for the lead
- `InfoRow` (in `group-info/info-row.tsx`, not in my Allowed files) has no `disabled` prop, so "disabled while busy" is enforced by not calling `onArchive` while `busy`; the row keeps its normal red look during the archive request instead of dimming. Say if you want a `disabled` prop added to `InfoRow` in a follow-up.
- The Archive row only draws when `canArchive` is true, as before; it is still its own `InfoGroup` after Mute / Leave.
- I followed the spec's plain label ("Tools and routines") without the board's "1 · 2" count, since the sheet does not load those counts.
- No tests added (UI and listing), per the spec.
- Everything stayed inside the Allowed files; nothing pushed or merged.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `ff7a30be6`.
- **Emulator check of the branch's mock build** (smoke PASS for `/topic-tools/t-devteam-bug?group=g-devteam`):
  - **"Checkout button hidden on Safari"'s sheet** shows AIs, People, then **Tools and routines**. No roles line; Archive topic is a red row in its own group.
  - **Tapping the row** opens the topic's page ("prices" v2 and "Morning prices" with Pause/Delete).
- **Not filed:** the pre-review follow-up (InfoRow has no dimmed disabled state for Archive while busy; the press is already ignored) and the mock route nit.

