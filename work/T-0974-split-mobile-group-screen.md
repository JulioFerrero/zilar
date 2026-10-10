---
id: T-0974
title: "Size split T26: apps/mobile/src/app/group/[id].tsx (835 lines) into components/chat/{group-header,group-topic-list,use-group-roles,use-group-invite-links,use-group-visibility,use-group-new-topic,group-action}"
status: merged
milestone: M5
branch: task/T-0974-split-mobile-group-screen
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0974: Split the mobile group screen

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/app/group/[id].tsx` is 835 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #22 (task T26). The new files go in `apps/mobile/src/components/chat/`:
- `group-header.tsx`, `group-topic-list.tsx`;
- `use-group-roles.ts`, `use-group-invite-links.ts`, `use-group-visibility.ts`, `use-group-new-topic.ts`;
- `group-action.ts`.

The route file keeps its default export, the header, the notices and the five sheets.

The in-file Dedup is in scope. `group-action.ts` holds the `rawCall` and the fixed-sentence `catch` plus `ensuring` wrapper that the roles, links, archive, pref and visibility blocks each repeat. Every error sentence stays exactly the same.

The lead runs a phone smoke of `/group/g-devteam` in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #22, and `apps/mobile/src/app/group/[id].tsx`.

### Allowed files
`apps/mobile/src/app/group/[id].tsx`, `apps/mobile/src/components/chat/group-header.tsx`, `apps/mobile/src/components/chat/group-topic-list.tsx`, `apps/mobile/src/components/chat/use-group-roles.ts`, `apps/mobile/src/components/chat/use-group-invite-links.ts`, `apps/mobile/src/components/chat/use-group-visibility.ts`, `apps/mobile/src/components/chat/use-group-new-topic.ts`, `apps/mobile/src/components/chat/group-action.ts`, `work/T-0974-split-mobile-group-screen.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, the Report has everything `split-rules.md` item 8 asks for, and the lead's phone smoke passes.

---

## Report (written by the worker when done)

### What I did

Split `apps/mobile/src/app/group/[id].tsx` (835 lines, main at `a64ac2b6`) per `docs/audit/size-plan.md` §2.2 #22 (task T26) and `docs/audit/split-rules.md`. The route keeps its default export `GroupTopicsScreen` (Expo Router needs it), the header (rendered through `GroupHeader`), the notices and the five sheets. Eight new files under `apps/mobile/src/components/chat/`:
`group-header.tsx`, `group-topic-list.tsx`, `group-action.ts`; `use-group-roles.ts`, `use-group-invite-links.ts`, `use-group-visibility.ts`, `use-group-new-topic.ts`.

### Files and sizes (`wc -l`)

- old `apps/mobile/src/app/group/[id].tsx`: **835**
- new:
  - `apps/mobile/src/app/group/[id].tsx`: **336**
  - `apps/mobile/src/components/chat/group-action.ts`: **25**
  - `apps/mobile/src/components/chat/group-header.tsx`: **63**
  - `apps/mobile/src/components/chat/group-topic-list.tsx`: **116**
  - `apps/mobile/src/components/chat/use-group-roles.ts`: **95**
  - `apps/mobile/src/components/chat/use-group-invite-links.ts`: **133**
  - `apps/mobile/src/components/chat/use-group-visibility.ts`: **186**
  - `apps/mobile/src/components/chat/use-group-new-topic.ts`: **91**

Every file is under the 400-line limit, and no `max-lines` warning appears.

### Export list, before → after

Before (`git show main:apps/mobile/src/app/group/[id].tsx | grep -E "^export"`) there was exactly one export:

```
export default function GroupTopicsScreen() {
```

After (`grep -E "^export"` over the route plus the new files):

```
apps/mobile/src/app/group/[id].tsx:export default function GroupTopicsScreen() {
apps/mobile/src/components/chat/group-action.ts:export function rawCall<A>(call: () => Promise<A>) {
apps/mobile/src/components/chat/group-action.ts:export function groupAction<A>(
apps/mobile/src/components/chat/group-header.tsx:export function GroupHeader({
apps/mobile/src/components/chat/group-topic-list.tsx:export function GroupTopicList({
apps/mobile/src/components/chat/use-group-roles.ts:export function useGroupRoles(groupId: string, members: readonly GroupMember[]) {
apps/mobile/src/components/chat/use-group-invite-links.ts:export function useGroupInviteLinks(groupId: string) {
apps/mobile/src/components/chat/use-group-visibility.ts:export function useGroupVisibility(groupId: string) {
apps/mobile/src/components/chat/use-group-new-topic.ts:export function useGroupNewTopic(options: { groupChatId: string; myAis: readonly GroupAi[] }) {
```

The route's own surface is unchanged (default `GroupTopicsScreen`), and no importer changed (`rawCall` was module-private before and is now exported for the moved blocks). No file outside the Allowed files is touched.

### Dedup (as the plan entry asked)

- `group-action.ts`: one `rawCall` (old 52–54) plus one `groupAction(work, fail, settle?)` wrapper that folds the `catch` + `ensuring` shape the roles, links, archive, pref and visibility blocks each re-inlined. Every error sentence is passed in unchanged, so the exact strings are identical:
  - roles load/write: `describeRolesError(cause, 'load' | 'write')`;
  - links: `Could not load invite links. Try again.` / `Could not create the invite link. Try again.` / `Could not revoke the invite link. Try again.`;
  - archive: `Could not archive the topic. Try again.`;
  - pref: `Could not save. Try again.`;
  - visibility load: `Could not load visibility. Try again.`; visibility save: `visibilitySaveError(cause)`.
- `group-header.tsx` renders the header `View` (old 607–637); the route keeps the `SafeAreaView` shell and renders the component, so the spec's "the route file keeps … the header" holds as "keeps rendering the header", which is the only reading consistent with the entry also listing `group-header.tsx`.
- `group-topic-list.tsx` folds the search field + list + Archived toggle + create FAB (old 650–714) into one component; `search`, `archivedOpen` and `useKeyPress` moved with it because they only feed that block.

### Behaviour-preserving moves

- The hook state and handlers move unchanged: roles (`useQuery` load, `runRolesWrite`, `toggleRoleMember`), invite links (`fetchLinks`/`loadLinks`/`openLinks`/create/revoke and the `linksShare` bridge), visibility (load/handle-check/save), new topic (create-then-add-AI effect).
- Archive and pref stay in the route (they feed `TopicActionsSheet`) and now use `groupAction`.
- The one ordering-sensitive block, the invite-link create, keeps `tap(setCreatedUrl) → andThen(fetchLinks) → catch` exactly: `groupAction` catches only after `andThen(fetchLinks)`, so a create failure still shows the create sentence and does not fetch or overwrite it.
- `group-action.ts` is the plan's dedup, so `kind: effect` (imports Effect) and needs no `// effect-plain` marker. No new file needed the marker; the effect ratchet passed.

### Commands and results

- `pnpm install`: done (`Done in 18.1s using pnpm v10.32.1`).
- `pnpm gate` (repo root): **GATE PASS**.
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (0.7s)
  PASS  lint  (0.5s)
  PASS  typecheck  (3.3s)
  PASS  effect  (0.9s)
  SKIP  tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- No single test file run: the mobile package has no test near these files (the only `group-screen-sheets.test.tsx` mentioned in a moved comment does not exist on this branch).
- Two intermediate gate runs failed and were fixed before the pass: `format` (one file reformatted by the repo Prettier) and `lint` (an unused `useAction` import removed).

### Deviations and notes

- The route holds fewer lines than "move ~640, remove ~70" implies because the state and small derived values that only feed a moved block moved with it (search, archived toggle, key-press, visibility state). Net: the old 835 lines become 336 in the route + 709 across the new files (1,045 total), all behaviour-identical.
- The `group-screen-sheets.test.tsx` comment was carried over from the old file; that test is not present in the repo.
- Per the spec, the header is extracted; the route renders it (`<GroupHeader … />`).

### Open questions

- The phone smoke of `/group/g-devteam` (spec: "the lead runs a phone smoke") has not run yet.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 3 optional nits.**
- **The split:** `group/[id].tsx` (835 lines) is now 336 lines, plus the new files under `components/chat/`, the largest `use-group-visibility.ts` at 186.
- **The lead's phone smoke** (mock build, `/group/g-devteam`): the header shows "Dev team, 5 members, 2 AIs, 7 topics", with the link, visibility and members buttons. The topic search and all 7 topics show with their status chips, and the private topic shows its lock.
- **Check:** the gate passed.
