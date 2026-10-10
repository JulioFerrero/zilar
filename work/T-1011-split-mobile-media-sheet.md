---
id: T-1011
title: "Size split T87: apps/mobile/src/components/chat/media-sheet.tsx (491 lines) into chat/{media-rows,media-sheet-content}; one MediaRow shell"
status: merged
milestone: M5
branch: task/T-1011-split-mobile-media-sheet
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1011: Split the mobile media sheet

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/mobile/src/components/chat/media-sheet.tsx` is 491 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #83 (task T87): `components/chat/media-rows.tsx` and `chat/media-sheet-content.tsx`, under `apps/mobile/src/`. `media-sheet.tsx` keeps the sheet and every export it has today.

- **In scope:** the in-file part of the Dedup. `FileRow`, `LinkRow` and `VoiceRow` share one `MediaRow` shell, and each keeps its own texts and icons.
- **Out of scope:** the `formatFileSize` move, because it crosses files.

The lead runs a phone smoke of a chat's "Media, files and links" sheet in a mock build.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #83, and `apps/mobile/src/components/chat/media-sheet.tsx`.

### Allowed files
`apps/mobile/src/components/chat/media-sheet.tsx`, `apps/mobile/src/components/chat/media-rows.tsx`, `apps/mobile/src/components/chat/media-sheet-content.tsx`, `work/T-1011-split-mobile-media-sheet.md`.

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
Split `apps/mobile/src/components/chat/media-sheet.tsx` (491 lines) into a thin barrel plus two new files, per `docs/audit/size-plan.md` §2.2 #83 and `docs/audit/split-rules.md`:

- `media-rows.tsx`: the media grid, the per-tab row list and their helpers, plus one shared `MediaRow` shell.
- `media-sheet-content.tsx`: the pure `MediaSheetContent` view, the tab labels and the text constants.
- `media-sheet.tsx` keeps `MediaSheet`, all of its state/loading logic, and re-exports every name it exported before. No importer changes.

Dedup (in scope): `FileRow`, `LinkRow` and `VoiceRow` now share one `MediaRow` shell (the common `<View className="flex-row items-center gap-2 border-t border-divider py-2">` plus the trailing `ShowInChatButton`); each row keeps its own body/texts and its own button label. The `formatFileSize` move into `chat-core` is out of scope (it crosses files) and was not done; `formatMediaSize` is unchanged.

### Files changed
- `apps/mobile/src/components/chat/media-sheet.tsx` (barrel)
- `apps/mobile/src/components/chat/media-rows.tsx` (new)
- `apps/mobile/src/components/chat/media-sheet-content.tsx` (new)
- `work/T-1011-split-mobile-media-sheet.md`

### Line counts (split-rules #8)
| file | `wc -l` |
| --- | ---: |
| old `media-sheet.tsx` (main) | 491 |
| new `media-sheet.tsx` | 198 |
| new `media-rows.tsx` | 231 |
| new `media-sheet-content.tsx` | 103 |

Every file is under 400.

### Export diff (split-rules #8)
Public exports of the barrel before (old file) and after (barrel re-exports), sorted; `diff` is empty:

```
MEDIA_EMPTY_TEXT
MEDIA_LOAD_ERROR_TEXT
MEDIA_LOADING_TEXT
MediaSheet
MediaSheetContent
MediaSheetContentProps
MediaSheetProps
MediaSheetStatus
formatDuration
formatMediaSize
```

`media-rows.tsx` additionally exports `MediaGrid` and `MediaRowList` for `media-sheet-content.tsx`; these are new internal exports and were never part of the old file's surface. The barrel does not re-export them.

### Deviation from the plan
`formatMediaSize` lives in `media-rows.tsx` (the plan's §2.2 #83 range assigns it to `media-sheet-content.tsx`). `media-rows.tsx` is the only user of it and `media-sheet-content.tsx` imports `MediaGrid`/`MediaRowList` from `media-rows.tsx`, so keeping it in `media-sheet-content.tsx` would create a `content → rows → content` import cycle (split-rules #3). No other code moved differently.

### Effect ratchet
Neither new file imports `effect` nor hits any hard/weak signal, so both classify as `plain`. The gate's effect step passed and no `// effect-plain:` marker was needed.

### Commands and results
- `pnpm install` — exit 0 (peer-dependency warning only, pre-existing).
- `pnpm --filter @zilar/mobile typecheck` — exit 0, no output.
- `pnpm gate` — `GATE PASS`, run twice (before the Report and again on the final commit; both pass):
```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (0.7s)
PASS  lint  (0.7s)
PASS  typecheck  (0.8s)
PASS  effect  (0.5s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

No test run: `apps/mobile/src/components/chat/` has no test files, so the gate skipped the nearest tests for `@zilar/mobile`.

### Problems / open questions
None. No behaviour change; the only external importer (`chat-overlays.tsx`) still imports `MediaSheet` from the unchanged path.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `media-sheet.tsx` (491 lines) is now 198 lines, plus `media-rows` (231) and `media-sheet-content`. One `MediaRow` shell serves the file, link and voice rows.
- **The lead's phone smoke** (mock build, Ana's chat): the header's "Media, files and links" opens the sheet with the Media, Files, Links and Voice tabs.
- **Not checked:** the rows. The mock backend has no media domain (mock wave 2), so the sheet shows "Could not load media", on main too.
- **Check:** the gate passed.
