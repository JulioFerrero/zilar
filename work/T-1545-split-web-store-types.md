---
id: T-1545
title: "Split apps/web/src/store/store.ts (400 lines, the limit): the group and topic members of the ChatStore interface move to store/groupStoreTypes.ts as ChatStoreGroupApi, which ChatStore extends; store.ts keeps every export; no behaviour change"
status: merged
milestone: M5
branch: task/T-1545-split-web-store-types
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1545: Split the web store's types

## Spec (written by Claude, do not edit)

### Why
`apps/web/src/store/store.ts` is exactly 400 lines, so no web task can add store state; T-1535 had to avoid it. **Follow `docs/audit/split-rules.md`.**

The old `size-plan.md` entry #59 is stale: the file is now 400 lines, not 561, and `selectors.ts` and `chatGroups.ts` already exist. So this spec names the cut.

### Facts (the lead read them on main, 2026-10-15)
- **`store.ts`:**
  - imports (`:1-43`);
  - `export interface ChatStore {` (`:45-356`);
  - `export type ChatStoreState = ChatStore & {…}` (`:358-383`);
  - re-exports (`:385-400`).
- **Inside `ChatStore`:** the group and topic members run from `groupMembers` (`:68-69`) through the group-settings setters, ending before `chatPrefs` (`:175`). They cover:
  - group members and info, and adding or removing AIs;
  - the topic notice, the topic AIs and members, and leaving;
  - the group's topic-creation switch, background and AI listener.
- **Other store files:** `selectors.ts`, `chatGroups.ts`, `storeOptions.ts` and `realStore.ts` live in `apps/web/src/store/`.

### Steps
1. **New `apps/web/src/store/groupStoreTypes.ts`:** `export interface ChatStoreGroupApi { … }` holds those group and topic members **unchanged** (comments included), with the type imports they need.
2. **`store.ts`:** `export interface ChatStore extends ChatStoreGroupApi { … }` keeps the rest. Remove the imports only the moved members used. Also export `ChatStoreGroupApi` from `store.ts`.
3. **Every name `store.ts` exported before is still exported**, with the same kind. No other file changes.
4. **Size:** `store.ts` ends at or below about 300 lines, and the new file below 400.

### Tests
None. The nearest kept tests (`apps/web/src/store/realStore.*.test.tsx`) must pass in the gate.

### Allowed files
- `apps/web/src/store/store.ts`
- `apps/web/src/store/groupStoreTypes.ts` (new)
- `work/T-1545-split-web-store-types.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The Report gives:**
  - the `wc -l` of both files;
  - the `store.ts` export list before and after (identical, plus `ChatStoreGroupApi`);
  - the gate summary.
- The typecheck passes with no other file touched.

---

## Report (written by the worker when done)

### What I did

Split `apps/web/src/store/store.ts` (400 lines) by moving the group and topic members of the `ChatStore` interface, unchanged, into a new `apps/web/src/store/groupStoreTypes.ts` as `export interface ChatStoreGroupApi`. `ChatStore` now extends it (`export interface ChatStore extends ChatStoreGroupApi`), and `store.ts` re-exports `ChatStoreGroupApi`. Every other export is unchanged in name and kind, so no importer changes.

- **`apps/web/src/store/groupStoreTypes.ts` (new, 115 lines):** holds original `store.ts` lines 68-169 verbatim (group members/info, add/remove AIs, topic notice, topic and channel endpoints, group-membership and group-settings setters), with only the type imports those members use: `MentionMember` from `@zilar/chat-core`; `CreateTopicInput`, `GroupBackground`, `GroupDetail`, `PatchTopicInput`, `PublicAi`, `SetGroupListenerInput`, `SetTopicRolesInput` from `@/lib/api`.
- **`apps/web/src/store/store.ts` (400 -> 288 lines):** removed the moved block and the imports only it used (`MentionMember`; and the six `@/lib/api` names above), added `import type { ChatStoreGroupApi } from './groupStoreTypes'`, and re-exported it. `GroupDetail` stayed imported in `store.ts` because `ChatStoreState.groupInfos` still uses it.
- **Boundary note:** the spec said the moved block ends "before `chatPrefs` (`:175`)". Lines 170-174 are the doc comment for `chatPrefs`, so I left them with `chatPrefs` and moved exactly lines 68-169. I verified the moved text is byte-identical to `git show HEAD:...store.ts | sed -n '68,169p'` (`diff` reported `IDENTICAL`).

### `wc -l`
- before: `apps/web/src/store/store.ts` 400
- after: `apps/web/src/store/store.ts` 288; `apps/web/src/store/groupStoreTypes.ts` 115

### Export list, before vs after (`grep -nE "^export"`)

Before (`store.ts`): `ChatStore` (interface), `ChatStoreState`, `export type {…}` (the storeOptions re-export block), `matchesFolder, visibleChats`, `groupChats, folderUnread`, `ChatGroup`, `MUTE_DURATIONS, applyChatPrefs, effectivePrefFor, mutedUntilFor, sortPinnedFirst`, `MuteDurationId`.

After (`store.ts`): the same list, same kinds, plus `export type { ChatStoreGroupApi } from './groupStoreTypes';`. Only `ChatStore`'s declaration changed form (`export interface ChatStore {` -> `export interface ChatStore extends ChatStoreGroupApi {`); the `export type {…}` block is untouched. Nothing was dropped. All importers use `ChatStoreState` / value exports from the same path, so none needed editing.

### Checks run

- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/realStore`: **6 files passed, 38 tests passed** (3.02s). These are the nearest kept tests named in the spec (`realStore.*.test.tsx`).
- `pnpm gate` (repo root), summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.6s)
  PASS  format  (1.2s)
  PASS  lint  (1.5s)
  PASS  typecheck  (7.5s)
  PASS  effect  (4.5s)
  PASS  tests @zilar/web  (22.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Files changed: `apps/web/src/store/store.ts`, `apps/web/src/store/groupStoreTypes.ts`, `work/T-1545-split-web-store-types.md` (all allowed).

### Effect ratchet

No `// effect-plain:` marker was added. The new file is types only (no values, no `async`, no `effect`/legacy imports), so the ratchet classifies it `plain`; the gate `effect` step reported `PASS`.

### Security checklist

Type-only move, no runtime code, no routes, no I/O and no secrets; the behaviour-relevant items (scoped deletes, atomic caps, 404 parity, rate limits, audit content) are untouched and not applicable.

### Notes for the lead

- No behaviour change, no new tests, no file outside the Allowed files.
- One interpretation call: lines 170-174 belong to the `chatPrefs` doc comment and stayed in `store.ts` (moved range is 68-169, byte-identical). If you meant them to move too, say so and I will adjust.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **What the lead checked:**
  - `store.ts` drops from 400 to 288 lines, and `groupStoreTypes.ts` is 115;
  - `ChatStore extends ChatStoreGroupApi`;
  - the `^export` lines differ from main only by the `extends` and the new type re-export `ChatStoreGroupApi`.
- **The `chatPrefs` comment staying in `store.ts` is right:** it belongs to `chatPrefs`. The web store now has room for new state.

