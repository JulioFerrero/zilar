---
id: T-1547
title: "Split packages/client-core/src/store/chat-rows.ts (399 lines): the topic mappers (topicOf, chatEntryTopics, topicInfoOf, topicActivityOf, isTopicAiState, summaryForTopic) move to store/topic-rows.ts; chat-rows.ts keeps its exports; no behaviour change"
status: merged
milestone: M5
branch: task/T-1547-split-chat-rows
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1547: Split chat-rows.ts

## Spec (written by Claude, do not edit)

### Why
`packages/client-core/src/store/chat-rows.ts` is 399 lines. It maps `/api/chats` entries to chat rows for both web and phone, so the next topic field would push it past the limit. **Follow `docs/audit/split-rules.md`.**

### Facts (the lead read them on main, 2026-10-15)
- **Exports:**
  - `ServerRowFields` (`:32`);
  - `previewMessageOf` (`:88`);
  - `mergeUnread` (`:127`);
  - `chatEntryTopics` (`:165`);
  - `summariesFor` (`:349-399`).
- **Internal:**
  - row helpers `archiveMarkOf`, `createdAtOf`, `unreadOf`, `previewParts` and `previewAt` (`:43-125`);
  - topic mappers `topicOf` (`:155`), `topicInfoOf` (`:182`), `topicActivityOf` (`:202`), `isTopicAiState` (`:218`) and `summaryForTopic` (`:286-348`);
  - `summaryFor` (`:223-285`).
- **Imports** at `:15-28` (`@zilar/chat-core` types, `effect`, `@zilar/api-contract`).

### Steps
1. **New `packages/client-core/src/store/topic-rows.ts`:** move `topicOf`, `chatEntryTopics`, `topicInfoOf`, `topicActivityOf`, `isTopicAiState` and `summaryForTopic` unchanged.
   - Export what `chat-rows.ts` needs.
   - If `summaryForTopic` uses row helpers that stay in `chat-rows.ts` (`unreadOf`, `previewMessageOf` and so on), move the shared helpers into the new file, or a small `row-helpers.ts`, so there is no import cycle: `chat-rows.ts` imports `topic-rows.ts`, never the other way.
2. **`chat-rows.ts`** keeps `summaryFor`, `summariesFor`, `mergeUnread`, `previewMessageOf` and `ServerRowFields`, and re-exports `chatEntryTopics`. Every name it exported before is still exported from it.
3. **No behaviour change**, and no importer changes.

### Tests
None new. The nearest client-core store tests must pass in the gate.

### Allowed files
- `packages/client-core/src/store/chat-rows.ts`
- `packages/client-core/src/store/topic-rows.ts` (new)
- `packages/client-core/src/store/row-helpers.ts` (new, only if needed)
- `work/T-1547-split-chat-rows.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The Report gives:**
  - the `wc -l` of each file;
  - the export list of `chat-rows.ts` before and after (identical);
  - the gate summary.

---

## Report (written by the worker when done)

### What I did

Followed `docs/audit/split-rules.md`. Moved code unchanged; no importer changed.

- **New `packages/client-core/src/store/topic-rows.ts`** (145 lines): the six topic mappers; the spec's own rule ("`chat-rows.ts` imports `topic-rows.ts`, never the other way") forced the shared row helpers out of `chat-rows.ts`, so I used the small `row-helpers.ts` the spec allows.
- **New `packages/client-core/src/store/row-helpers.ts`** (97 lines): `ServerRowFields`, `archiveMarkOf`, `createdAtOf`, `unreadOf`, `previewParts` and `previewMessageOf` — the helpers both `summaryFor` (stays in `chat-rows.ts`) and `summaryForTopic` (now in `topic-rows.ts`) use.
- **`chat-rows.ts`** (was 399, now 179): keeps `mergeUnread`, `summariesFor`, `ServerRowFields` and the internal `summaryFor`; re-exports `ServerRowFields` (type) and `previewMessageOf` from `row-helpers.ts`, and `chatEntryTopics` from `topic-rows.ts`. So every name it exported before is still exported from it, with the same kind.
- Import graph has no cycle: `chat-rows.ts` → `topic-rows.ts` → `row-helpers.ts`; `topic-rows.ts` does not import `chat-rows.ts`.

### Export list before → after

`grep -E "^export"` on `HEAD:chat-rows.ts` (names/kinds):

```
ServerRowFields (type), previewMessageOf, mergeUnread, chatEntryTopics, summariesFor
```

`grep -E "^export"` on the barrel `chat-rows.ts` after — **same five names and kinds**, only the moved ones are now re-exports:

```
export type { ServerRowFields } from './row-helpers';
export { previewMessageOf, chatEntryTopics };
export function mergeUnread(
export function summariesFor(entry: ChatEntry): ChatSummary[] {
```

`topic-rows.ts` additionally exports `summaryForTopic` (a value `chat-rows.ts` imports; not in the package barrel, so no public surface change). `row-helpers.ts` additionally exports `archiveMarkOf`, `createdAtOf`, `unreadOf` and `previewMessageOf` (sharing with `topic-rows.ts`; not in the package barrel).

### Line counts

- `packages/client-core/src/store/chat-rows.ts`: **179** (was 399).
- `packages/client-core/src/store/topic-rows.ts`: **145** (new).
- `packages/client-core/src/store/row-helpers.ts`: **97** (new).

All under 400; no `max-lines` warning.

### Checks run

1. `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/unread-merge.test.ts`
   → **Test Files 1 passed (1); Tests 7 passed (7)** (4.66s).
2. `pnpm gate` (from repo root) summary:
   ```
   gate: 4 changed file(s) against main
   PASS  install (frozen)  (2.1s)
   PASS  format  (0.7s)
   PASS  lint  (2.7s)
   PASS  typecheck  (3.8s)
   PASS  effect  (1.4s)
   PASS  tests @zilar/client-core  (8.6s)
   scope: every changed file is inside the Allowed files
   migration: every added migration continues from the base
   images: every workspace package an app image needs is copied into its Dockerfile
   size: every changed source file is within 400 lines
   GATE PASS
   ```
   `git status --short` shows exactly the four Allowed files (`chat-rows.ts` modified, `topic-rows.ts` and `row-helpers.ts` new, this task file).

- *First* gate run failed on `format` (`topic-rows.ts` only: Prettier collapsed the three-name `@zilar/api-contract` import to one line). Fixed with `pnpm exec prettier --write packages/client-core/src/store/topic-rows.ts`; the re-run above passed.

### Notes for the lead

- **Effect ratchet:** `topic-rows.ts` imports `effect` as a value (`Exit`, `Schema`) → kind `effect`; `row-helpers.ts` imports only `@zilar/chat-core` (type-only) and hits no hard/weak signal → kind `plain`. Neither is `needs-effect`, so no `// effect-plain:` marker was added; the gate printed `PASS effect`.
- **Spec reading:** the spec lists `ServerRowFields` and `previewMessageOf` as things `chat-rows.ts` "keeps", but `summaryForTopic` (moved to `topic-rows.ts`) uses both, and the spec also forbids `topic-rows.ts` importing `chat-rows.ts`. I therefore put the two in `row-helpers.ts` and re-exported them from `chat-rows.ts`; the exported name set is unchanged (split-rules §3). Say so if you wanted a type-only import of `ServerRowFields` from `chat-rows.ts` instead.
- No behaviour change: all moved bodies and comments are byte-identical apart from the added `export` keywords and the two new file headers.
- Not pushed, merged or branched.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **What the lead checked:**
  - **Sizes:** `chat-rows.ts` 179, `topic-rows.ts` 145 and `row-helpers.ts` 97 lines (was 399).
  - **Exports:** `chat-rows.ts` still exports `ServerRowFields` (type re-export), `previewMessageOf`, `chatEntryTopics` (re-export), `mergeUnread` and `summariesFor`.
  - **No cycle:** `chat-rows.ts` imports the new files, never the reverse.
