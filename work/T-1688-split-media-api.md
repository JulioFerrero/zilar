---
id: T-1688
title: "Size split of apps/server/src/media/api.ts (391 lines): move the gallery item mapping (MediaItem, roomNick, senderNameFor, toMediaItem and their comments) into a new media/items.ts that api.ts imports — a pure move"
status: merged
milestone: M5
branch: task/T-1688-split-media-api
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1688: Split the gallery item mapping out of media/api.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/media/api.ts` is 391 of 400 lines, so the media gallery and link-preview routes can't change. The row-to-item mapping is pure and self-contained.

### Facts (the lead read them on 2026-10-16)
- **`api.ts`:**
  - imports `:13-43` (`bareJid` from `../jid` `:21`; `MediaItemRow` from `../db/rows` `:24`; `SearchOwner` among the names from `../search/service` `:36-41`; `MediaChatScope` and `MediaKind` from `./indexer` `:43`);
  - **the block to move**, from the comment `// The reply schemas live in the shared contract …` (`:128`) through:
    - `export interface MediaItem :131-147`;
    - the comment about `at_micros`;
    - `function roomNick :156-159`;
    - `function senderNameFor(row, filter, allowed, domain) :161-178`;
    - `function toMediaItem(row, senderName) :180-198`;
  - then `const MediaApi = HttpApi.make('media')… :200` and `createMediaApi :202`.
- **Importers:** nothing outside `api.ts` imports `MediaItem`, `toMediaItem` or `senderNameFor` (`git grep`); `apps/server/src/app/routes-messaging.ts:23` imports only `createMediaApi`.
- **The folder `apps/server/src/media/`** holds `api.ts`, `extract.ts`, `indexer.ts`, `rows.ts` and `run-command.ts`; there's no `items.ts`.

### Steps
1. **Create `apps/server/src/media/items.ts`** with the block moved **word for word**, comments included.
   - Export `MediaItem`, `senderNameFor` and `toMediaItem`; `roomNick` stays private.
   - Bring the imports they need (`bareJid`, the `MediaItemRow` type, the `SearchOwner` type, and the `MediaChatScope` and `MediaKind` types).
2. **`api.ts`:** import what it uses from `./items`, delete the block, and drop the imports it no longer uses.
3. **No behaviour change, no new tests.**

### Allowed files
- `apps/server/src/media/items.ts`
- `apps/server/src/media/api.ts`
- `work/T-1688-split-media-api.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **`api.ts` is about 320 lines,** and `items.ts` holds the mapping unchanged.
- **The server typecheck passes.**

---

## Report (written by the worker when done)

### What I did

- Created `apps/server/src/media/items.ts` with the gallery-item mapping moved **word for word** from `api.ts` (comments included): `MediaItem`, `roomNick` (private), `senderNameFor` and `toMediaItem`. `senderNameFor` and `toMediaItem` are exported. Its imports are `bareJid` from `../jid`, the `MediaItemRow` type from `../db/rows`, the `SearchOwner` type from `../search/service`, and the `MediaChatScope` and `MediaKind` types from `./indexer`.
- `apps/server/src/media/api.ts`: deleted that block and imported `senderNameFor` and `toMediaItem` from `./items`. Dropped the now-unused imports `bareJid` (from `../jid`), `SearchOwner` (from `../search/service`) and `MediaChatScope` (from `./indexer`); `MediaKind`, `MediaItemRow`, `allowedArchives`, `resolveChatFilter` and `ArchivePool` are still used and kept.
- Verified the move is a pure move: `git show HEAD:.../api.ts | sed -n '128,198p'` diffed against the new `items.ts` block shows only the two added `export` keywords (`senderNameFor`, `toMediaItem`).
- No behaviour change, no new tests (per spec). `api.ts` is now 314 lines, `items.ts` 76 lines.

### Checks run

- `pnpm gate` from the repo root — ended with **GATE PASS**:
  - `PASS install (frozen)` (2.7s), `PASS format` (1.4s), `PASS lint` (2.1s), `PASS typecheck` (7.1s), `PASS effect` (2.1s)
  - `SKIP tests @zilar/server (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `size: every changed source file is within 400 lines`
- No single test file was run: there is no test near `media/` (`git grep` finds no gallery/`MediaApi`/`media_unavailable` tests), and the spec says no new tests.

### Notes for the lead

- Nothing blocked; all changed files are inside the Allowed files. `git status`/gate report 3 changed files: `apps/server/src/media/items.ts`, `apps/server/src/media/api.ts`, `work/T-1688-split-media-api.md`.

## Review (written by Claude)

**Approved and merged.** A pure size split.

- **Pre-review:** clean, 0 nits.
- **The lead's check:** the removed lines equal `items.ts` apart from two type names dropped from `api.ts`'s import list.
- **Result:** `media/api.ts` drops from 391 to 314 lines.
