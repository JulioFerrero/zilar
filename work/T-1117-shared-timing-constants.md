---
id: T-1117
title: "Drift 0.2: the GIF search, people search and chat refresh debounce constants (copied in web and mobile, same values) move to the shared packages"
status: merged
milestone: M5
branch: task/T-1117-shared-timing-constants
model: auto
effort: default
depends_on: [T-1116]
estimate: 0.05 day
---

# T-1117: Shared timing constants

## Spec (written by Claude, do not edit)

### Why
Simplify-plan item 0.2 ("one search debounce"): the message-search debounce already lives in `packages/chat-core/src/search.ts:2` (`MESSAGE_SEARCH_DEBOUNCE_MS = 250`). Three more timing constants are copied in both apps with the **same values** (read by the lead):
- **The GIF search debounce, 300 ms:**
  - `apps/web/src/components/GifPanel.tsx:36` (`const SEARCH_DEBOUNCE_MS = 300`, used at `:215`);
  - `apps/mobile/src/lib/gifs.ts:72` (`export const GIF_SEARCH_DEBOUNCE_MS = 300`, used in `apps/mobile/src/components/chat/gif-panel.tsx:11,191`).
- **The people search debounce, 900 ms:**
  - `apps/web/src/lib/usePeopleSearch.ts:9` (used at `:118`);
  - `apps/mobile/src/components/contacts/people-search.ts:23` (used at `:165`).
- **The chat refresh debounce, 500 ms:**
  - `apps/web/src/store/effects/constants.ts:7` (used in `apps/web/src/store/effects/history.ts:15,67`);
  - `apps/mobile/src/store/effects/events.ts:18` (used at `:61`).
  - The shared store constants already live in `@zilar/client-core/store`, for example `TYPING_CLEAR_MS` in `packages/client-core/src/store/incoming.ts:22`.

### What to build
1. **`packages/chat-core/src/search.ts`:** add `GIF_SEARCH_DEBOUNCE_MS = 300` and `PEOPLE_SEARCH_DEBOUNCE_MS = 900`, each with a one-line comment. `chat-core`'s index already exports `./search`.
2. **`packages/client-core/src/store/incoming.ts`:** add `CHAT_REFRESH_DEBOUNCE_MS = 500` next to `TYPING_CLEAR_MS`. Check that `@zilar/client-core/store` exports it the same way.
3. **The apps:** delete the six local definitions and import from the package instead. Where a file re-exports its constant today (`apps/mobile/src/lib/gifs.ts`, `apps/web/src/lib/usePeopleSearch.ts`, `apps/mobile/src/components/contacts/people-search.ts`, `apps/web/src/store/effects/constants.ts`, `apps/mobile/src/store/effects/events.ts`), keep the export as a re-export from the package, so other importers keep working. Web `GifPanel` uses the shared name.
4. **The values are unchanged.** No tests.

### Read first
`AGENTS.md`, and the files above.

### Allowed files
`packages/chat-core/src/search.ts`, `packages/client-core/src/store/incoming.ts`, `packages/client-core/src/store/index.ts`, `apps/web/src/components/GifPanel.tsx`, `apps/mobile/src/lib/gifs.ts`, `apps/mobile/src/components/chat/gif-panel.tsx`, `apps/web/src/lib/usePeopleSearch.ts`, `apps/mobile/src/components/contacts/people-search.ts`, `apps/web/src/store/effects/constants.ts`, `apps/web/src/store/effects/history.ts`, `apps/mobile/src/store/effects/events.ts`, `work/T-1117-shared-timing-constants.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- `grep -rn "= 300;\|= 900;\|= 500;" apps/web/src apps/mobile/src | grep -i "debounce"` prints nothing.

---

## Report (written by the worker when done)

**status: review** — all six in-scope definitions are gone from the apps and come from the shared packages; `pnpm gate` is green.

### What I did
Moved the three shared timing constants into the shared packages and turned the six app definitions into re-exports of the shared values. Values unchanged; no tests added (spec: "No tests").

- `packages/chat-core/src/search.ts`: added `GIF_SEARCH_DEBOUNCE_MS = 300` and `PEOPLE_SEARCH_DEBOUNCE_MS = 900`, each with a one-line comment. `chat-core`'s index already has `export * from './search'`, so no change there.
- `packages/client-core/src/store/incoming.ts`: added `CHAT_REFRESH_DEBOUNCE_MS = 500` next to `TYPING_CLEAR_MS`. `store/index.ts` already has `export * from './incoming'`, so it exports the new constant unchanged (no edit was needed to `index.ts`).
- `apps/web/src/components/GifPanel.tsx`: dropped the local `const SEARCH_DEBOUNCE_MS = 300`; now imports `GIF_SEARCH_DEBOUNCE_MS` from `@zilar/chat-core` and uses that name at the search effect (`Effect.sleep(GIF_SEARCH_DEBOUNCE_MS)`).
- `apps/mobile/src/lib/gifs.ts`: replaced `export const GIF_SEARCH_DEBOUNCE_MS = 300` with `export { GIF_SEARCH_DEBOUNCE_MS } from '@zilar/chat-core'`. Its importer `apps/mobile/src/components/chat/gif-panel.tsx` (`:11`, `:191`) keeps working unchanged.
- `apps/web/src/lib/usePeopleSearch.ts`: imports `PEOPLE_SEARCH_DEBOUNCE_MS` from `@zilar/chat-core` and re-exports it (used locally at `:118`).
- `apps/mobile/src/components/contacts/people-search.ts`: imports `PEOPLE_SEARCH_DEBOUNCE_MS` from `@zilar/chat-core` and re-exports it (used locally at `:165`).
- `apps/web/src/store/effects/constants.ts`: removed `export const CHAT_REFRESH_DEBOUNCE_MS = 500`; re-exports it from `@zilar/client-core/store` together with `LAST_READ_PREFIX` and `TYPING_CLEAR_MS`. `history.ts` keeps importing it from `./constants`.
- `apps/mobile/src/store/effects/events.ts`: removed `export const CHAT_REFRESH_DEBOUNCE_MS = 500`; imports it from `@zilar/client-core/store` (used locally at `:61`) and re-exports it.

Files changed: the 8 files above plus this task file. `packages/client-core/src/store/index.ts` and `apps/web/src/store/effects/history.ts` needed no change.

### Commands and real results
- `pnpm install`: 16 workspace projects, done, no errors.
- Scoped acceptance grep — `grep -rn "GIF_SEARCH_DEBOUNCE_MS =\|PEOPLE_SEARCH_DEBOUNCE_MS =\|CHAT_REFRESH_DEBOUNCE_MS =\|const SEARCH_DEBOUNCE_MS" apps packages/*/src` — lists only the package definitions, nothing under `apps/`:
  ```
  packages/chat-core/src/search.ts:5:export const GIF_SEARCH_DEBOUNCE_MS = 300;
  packages/chat-core/src/search.ts:8:export const PEOPLE_SEARCH_DEBOUNCE_MS = 900;
  packages/client-core/src/store/incoming.ts:25:export const CHAT_REFRESH_DEBOUNCE_MS = 500;
  ```
- `pnpm gate` — final run, GATE PASS, summary lines:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.6s)
  PASS  typecheck  (0.6s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/chat-core  (0.6s)
  PASS  tests @zilar/client-core  (0.9s)
  PASS  tests @zilar/mobile  (1.3s)
  PASS  tests @zilar/web  (2.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  I did not run any single test file separately; gate covered the four touched packages.
- The first `pnpm gate` failed only on `format` for `apps/web/src/store/effects/constants.ts` (my first re-export line was 104 characters and over Prettier's width). I hand-formatted it to Prettier's multi-line shape; the second gate passed. I did not run `pnpm format` directly.

### Note on the acceptance check
The spec's original acceptance grep (`= 300;\|= 900;\|= 500;` piped through `grep -i debounce`) also matched `apps/mobile/src/components/settings/use-profile-settings.ts:26` (`const HANDLE_CHECK_DEBOUNCE_MS = 300`), a mobile-only, non-exported constant with no web twin and no relation to the three named constants. The lead confirmed that grep was too broad and that this app-only constant (and any other app-only debounce) stays out of scope. The scoped grep above is the acceptance: only the two packages define these constants now.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:**
  - `GIF_SEARCH_DEBOUNCE_MS = 300` and `PEOPLE_SEARCH_DEBOUNCE_MS = 900` move to `packages/chat-core/src/search.ts`;
  - `CHAT_REFRESH_DEBOUNCE_MS = 500` moves to `packages/client-core/src/store/incoming.ts`.
  - The six app copies are now imports or re-exports. The values are unchanged.
- **The lead's grep** finds only those three package definitions. The mobile-only `HANDLE_CHECK_DEBOUNCE_MS` stays (the lead's grep in the spec was too broad).
- **The gate passed.**
