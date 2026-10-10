---
id: T-1020
title: "Size split T72: apps/mobile/src/app/(tabs)/index.tsx (537 lines) into components/chat/{search-header,chat-search-results,chat-rows,chat-list,chat-actions-host,use-chat-actions}; one Chat/Group row switch"
status: merged
milestone: M5
branch: task/T-1020-split-mobile-chats-tab
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1020: Split the mobile chats tab

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/app/(tabs)/index.tsx` is 537 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #68 (task T72). The new files go in `apps/mobile/src/components/chat/`:
- `search-header.tsx`;
- `chat-search-results.tsx`;
- `chat-rows.tsx`;
- `chat-list.tsx`;
- `chat-actions-host.tsx`;
- `use-chat-actions.ts`.

The screen keeps the `searchOpen` wiring, the branch selection and its default export. None of these names exist in that folder today. Leave the existing `chat-list-item.tsx` and `chat-actions-sheet.tsx` as they are.

- **In scope:** the in-file Dedup. `chat-rows.tsx` holds the one Chat/Group row switch that replaces the three copies.
- **Out of scope:** the `withKey` → `lib/collections.ts` move, because that file does not exist. `withKey` (`index.tsx:44`) moves with its caller.

The lead runs a phone smoke of the Chats tab in a mock build: the list, search, and a long-press on a chat.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #68, and `apps/mobile/src/app/(tabs)/index.tsx`.

### Allowed files
`apps/mobile/src/app/(tabs)/index.tsx`, `apps/mobile/src/components/chat/search-header.tsx`, `apps/mobile/src/components/chat/chat-search-results.tsx`, `apps/mobile/src/components/chat/chat-rows.tsx`, `apps/mobile/src/components/chat/chat-list.tsx`, `apps/mobile/src/components/chat/chat-actions-host.tsx`, `apps/mobile/src/components/chat/use-chat-actions.ts`, `work/T-1020-split-mobile-chats-tab.md`.

### Checks
```bash
pnpm --filter @zilar/mobile typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/mobile/src/app/(tabs)/index.tsx` (537 lines) following `docs/audit/split-rules.md` and `docs/audit/size-plan.md` §2.3 #68, moving code unchanged:

- `components/chat/search-header.tsx` — `SearchHeader`, the title/search-well header and the open search field with Cancel.
- `components/chat/chat-search-results.tsx` — `ChatSearchResults` (message-search branch, lines 296–377) and `ChatPeopleResults` (people-only branch, 381–404).
- `components/chat/chat-rows.tsx` — `ChatRow`, the one Chat/Group row switch, plus `chatRowKey`; it replaces the three copies (337–359, 438–452, 483–490).
- `components/chat/chat-list.tsx` — `ChatList`, the folder chips, connection line, FlatList (with skeleton/empty/error states) and the Archived entry.
- `components/chat/chat-actions-host.tsx` — `ChatActionsHost`, the action sheet wired to the hook.
- `components/chat/use-chat-actions.ts` — `useChatActions` and its `ChatActions` type: the action-sheet state, `openActions`/`closeActions` and the `saveChatPref` write. `withKey` moved here with its only caller (its `lib/collections.ts` move is out of scope, as the spec says).

The route keeps `RequireAuth`, the `searchOpen`/`searchChat` wiring, the branch selection and the default export. `chat-list-item.tsx` and `chat-actions-sheet.tsx` are untouched.

### Files changed and `wc -l`

- old `apps/mobile/src/app/(tabs)/index.tsx`: 537
- new `apps/mobile/src/app/(tabs)/index.tsx`: 229
- `apps/mobile/src/components/chat/search-header.tsx`: 75
- `apps/mobile/src/components/chat/chat-search-results.tsx`: 175
- `apps/mobile/src/components/chat/chat-rows.tsx`: 42
- `apps/mobile/src/components/chat/chat-list.tsx`: 137
- `apps/mobile/src/components/chat/chat-actions-host.tsx`: 69
- `apps/mobile/src/components/chat/use-chat-actions.ts`: 123

Every file is under 400 lines. `git diff --stat`: `index.tsx` 84 insertions / 392 deletions.

### Export list before and after

Before (`git show main:apps/mobile/src/app/(tabs)/index.tsx | grep -E "^export"`):

```
export default function ChatsScreen()
```

After (barrel `index.tsx` plus the new files):

```
apps/mobile/src/app/(tabs)/index.tsx:                    export default function ChatsScreen()
apps/mobile/src/components/chat/search-header.tsx:       export function SearchHeader
apps/mobile/src/components/chat/chat-search-results.tsx: export function ChatSearchResults
apps/mobile/src/components/chat/chat-search-results.tsx: export function ChatPeopleResults
apps/mobile/src/components/chat/chat-rows.tsx:           export function chatRowKey
apps/mobile/src/components/chat/chat-rows.tsx:           export function ChatRow
apps/mobile/src/components/chat/chat-list.tsx:           export function ChatList
apps/mobile/src/components/chat/chat-actions-host.tsx:   export function ChatActionsHost
apps/mobile/src/components/chat/use-chat-actions.ts:     export function useChatActions
apps/mobile/src/components/chat/use-chat-actions.ts:     export type ChatActions
```

The original path keeps its one export (`default ChatsScreen`), so no importer changes. No file outside the six new files and `index.tsx` is edited; `grep` found no other importer of the route.

### Effect ratchet (rule 6)

One marker was added: `apps/mobile/src/components/chat/chat-search-results.tsx` line 1 is

```
// effect-plain: moved unchanged from apps/mobile/src/app/(tabs)/index.tsx (size split)
```

Reason: the mock/real `searchApi` memo reads `process.env` (W7). The plan's line hint kept it in the screen (89–97), but the base `index.tsx` was classified `effect` because it imported `Effect` for `saveChatPref`, and that write moved to `use-chat-actions.ts`. Leaving the `process.env` memo in the screen made `index.tsx` regress to `needs-effect` (`effect: apps/mobile/src/app/(tabs)/index.tsx needs Effect (W7)`). Following the established convention (T-0962, `chat-composer-dock.tsx`), I moved the memo with its only consumer into `chat-search-results.tsx`, which is a new file holding the moved-unchanged code and carries the sanctioned marker. `index.tsx` is now `plain`; no other new file needed a marker. This is the one deviation from the plan's line hint.

### Commands and real results

- `pnpm install`: done in 15.7s, added 1172 packages; lockfile unchanged.
- `pnpm --filter @zilar/mobile typecheck`: `tsc --noEmit`, no errors (ran twice, before and after the move).
- `pnpm exec prettier --check` on the seven changed files: two needed formatting (`index.tsx`, `search-header.tsx`); fixed with `prettier --write` on those two.
- Effect ratchet, `tsx src/effect-map/ratchet-cli.ts --base main <7 files>`: first run failed on `index.tsx needs Effect (W7)`; after the marker move, `effect: ok (7 files checked)`.
- `pnpm gate` from the repo root:

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (1.4s)
PASS  format  (0.7s)
PASS  lint  (0.9s)
PASS  typecheck  (4.3s)
PASS  effect  (1.1s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Tests

No single test file was run: there are no test files in `apps/mobile/src/components/chat/` or `apps/mobile/src/app/(tabs)/`, so the gate skipped the mobile tests ("no nearby test files"), and rule 5 says to write no new tests for a UI split. No test or import path was changed.

### Problems / open questions

- No behaviour change was intended, and none is known. The `searchApi` memo now lives in `ChatSearchResults` instead of the screen; it is only ever consumed by `MessageSearchList` inside that component, and the component already remounts per search session, so identity and lifetime are unchanged for its consumer.
- No auth/keys/permissions/money/message-pipeline code is touched, so the security checklist has no new surface here.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `(tabs)/index.tsx` (537 lines) is now 229 lines, plus `components/chat/{search-header,chat-search-results,chat-rows,chat-list,chat-actions-host,use-chat-actions}`. One `chat-rows` switch replaces the three Chat/Group copies.
- **The lead's phone smoke** (mock build):
  - the list shows chat rows (Dev AI, Marta) and the group row (Dev team, 7 topics);
  - search shows the Chats section (Dev AI, Dev team) and the Messages section with highlighted matches;
  - a long-press on Marta opens Pin, Mute and Archive.
- **Seen on main too:** Pin shows "Could not save. Try again.", because the mock backend has no chat-prefs handler (wave 2).
- **The lead's line check:** the `saveChatPref` calls for pin, mute, unmute and archive are the same as on main; only the indentation changed.
- **Check:** the gate passed.
