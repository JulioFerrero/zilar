---
id: T-2185
title: "Phone (phone, wave 4): fold single-use component and helper files back into their only importer — fewer props interfaces, imports and exports; no behaviour or visual change"
status: merged
milestone: M5
branch: task/T-2185-fold-phone-4
model: deepseek/deepseek-flash
effort: default
estimate: 50 min
---

# T-2185: Fold single-use phone files (phone, wave 4)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the code map total must go down. 400 lines is a soft limit, and files an earlier task split only for size may be merged back when that saves lines. Only a file over 800 lines must split. A component that only one file renders costs its own imports, an exported props interface and the props plumbing; folding it into its host removes those.

The lead listed these at `1f43a4df4`. Each mover has exactly one production importer, the host; the tests listed import it too. Each host stays under 800 lines after its folds.

| Mover (lines) | Host (lines) | Tests that import the mover |
| --- | --- | --- |
| `components/profile/profile-person.ts` (8) | `app/u/[handle].tsx` (680) | 0 |
| `components/machines/machine-change.ts` (36) | `app/ais/[id].tsx` (655) | 0 |
| `lib/effect/raw-request.ts` (50) | `lib/machines-api.ts` (38) | 0 |
| `components/ais/computer-picker.tsx` (80) | `app/ais/[id].tsx` (655) | 0 |
| `lib/share-intent.ts` (106) | `app/share.tsx` (309) | 1 |
| `components/stickers/pack-card.tsx` (106) | `app/settings/stickers.tsx` (612) | 0 |
| `components/chat/row-gesture.tsx` (113) | `components/chat/message-bubble.tsx` (631) | 0 |
| `components/chat/attach/gallery-grid.tsx` (139) | `components/chat/attach-sheet.tsx` (600) | 0 |
| `components/chat/topic-link-row.tsx` (140) | `components/chat/topic-info-sheet.tsx` (633) | 0 |

All paths are under `apps/mobile/src/`.

### Steps
For each row, read both files.
1. **Fold:**
   - move the mover's code into the host, below the host's main export, and delete the mover;
   - carry the mover's header comment above the moved code when it says a "why" (docs/COMMENTS.md "Keep");
   - a moved component becomes a non-exported function in the host;
   - keep its props type only if it still needs a name, and drop props the host can now pass more simply only when the result is identical;
   - remove `export`s nothing else uses.
2. **Duplicates.** Drop any declaration that becomes a duplicate (two copies of the same type, constant or helper).
3. **Skip** a fold when the result would read worse. For example, the host would mix two unrelated screens, or reach 800 lines. Skip the `lib/share-intent.ts` row: `share-intent.test.ts` tests it on its own, and a route file is no place for it. Say why in the Report.

### Rules
- No behaviour change and no visual change: the same styles, accessibility labels, gestures, animations and effects.
- The diff only moves code and removes import/export/props plumbing. It changes no logic.
- Do not touch:
  - `apps/mobile/src/store/**`;
  - `apps/mobile/src/auth/**`;
  - any `apps/mobile/src/lib/*-api.ts`;
  - any `use-*-api.ts` hook.
- **Tests.** Update the import path, or the `jest.mock`/`vi.mock` path, in each listed test; change nothing else in it. No new tests.
- Product lines go down by at least 60.

### Allowed files
- `apps/mobile/src/app/ais/[id].tsx`
- `apps/mobile/src/app/settings/stickers.tsx`
- `apps/mobile/src/app/share.tsx`
- `apps/mobile/src/app/u/[handle].tsx`
- `apps/mobile/src/components/ais/computer-picker.tsx`
- `apps/mobile/src/components/chat/attach-sheet.tsx`
- `apps/mobile/src/components/chat/attach/gallery-grid.tsx`
- `apps/mobile/src/components/chat/message-bubble.tsx`
- `apps/mobile/src/components/chat/row-gesture.tsx`
- `apps/mobile/src/components/chat/topic-info-sheet.tsx`
- `apps/mobile/src/components/chat/topic-link-row.tsx`
- `apps/mobile/src/components/machines/machine-change.ts`
- `apps/mobile/src/components/profile/profile-person.ts`
- `apps/mobile/src/components/stickers/pack-card.tsx`
- `apps/mobile/src/lib/effect/raw-request.ts`
- `apps/mobile/src/lib/machines-api.ts`
- `apps/mobile/src/lib/share-intent.ts`
- `work/T-2185-fold-phone-4.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Product lines go down by at least 60.
- The Report lists each row: folded (lines saved) or skipped (why).
- **Lead check** (phone emulator smoke): phone emulator: a profile page, Edit Dev-1 (computer picker, machine change), share sheet, Settings → Stickers pack cards, swipe-to-reply on a message, the attach sheet gallery, a topic's info sheet links

---

## Report (written by the worker when done)

### What I did

Folded 8 of the 9 movers into their only production host and deleted the 8 mover files. Net product lines: **−61** (`git diff HEAD --numstat -- apps/mobile` → +638 / −699). Every touched host stays under 800 lines (largest: `topic-info-sheet.tsx`, 762). No styles, accessibility labels, gestures, animations, effects or logic changed.

| Mover (lines) | Host | Result |
| --- | --- | --- |
| `components/profile/profile-person.ts` (8) | `app/u/[handle].tsx` | folded, **6 saved**; `ProfilePerson` type kept (used 3×), its why comment condensed to one line |
| `components/machines/machine-change.ts` (36) + `components/ais/computer-picker.tsx` (80) | `app/ais/[id].tsx` | folded, **28 saved** for the pair; `MachineChangeOutcome` inlined; `ComputerPicker` label is now the fixed "Computer" it was always given; single-use `ChoiceGlyph` inlined |
| `lib/effect/raw-request.ts` (50) | `lib/machines-api.ts` | folded, **4 saved**; header why comment kept |
| `lib/share-intent.ts` (106) | `app/share.tsx` | **skipped** as the spec says: `share-intent.test.ts` tests it on its own and a route file is the wrong home |
| `components/stickers/pack-card.tsx` (106) | `app/settings/stickers.tsx` | folded, **2 saved** |
| `components/chat/row-gesture.tsx` (113) | `components/chat/message-bubble.tsx` | folded, **net +5 lines** (the host already imported React Native's `Animated`, so reanimated's default import and five named imports add lines); the file itself is gone |
| `components/chat/attach/gallery-grid.tsx` (139) | `components/chat/attach-sheet.tsx` | folded, **15 saved** |
| `components/chat/topic-link-row.tsx` (140) | `components/chat/topic-info-sheet.tsx` | folded, **11 saved** |

Files changed: the 7 hosts above plus deletions of the 8 movers. No test imports changed (none of the folded movers has a test; `share-intent.test.ts` is untouched because that row was skipped).

Moved-code adaptations, all behaviour-identical:
- `row-gesture`: reanimated's default export is aliased to `Reanimated` because the host already uses `Animated` from `react-native`; `tap()` uses the host's existing `tapHaptic` alias.
- Single-use props types/constants (`RowGestureProps`, `TopicLinkRowProps`, `GalleryCell`, `MAX_TRANSLATE_X`, `REPLY_THRESHOLD`, `LABEL_MAX`) were inlined where the type/name was no longer needed; one long comment in `applyMachineChange` and the gallery comment were condensed.

### Checks run

- `pnpm install` — completed cleanly.
- `pnpm gate` — final run: `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `SKIP build @zilar/server (no server, package or manifest change)`, `PASS tests @zilar/mobile (3.8s)`, `size: no changed source file is over 800 lines`, `comments: no task IDs in added comments`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.
- The two earlier gate runs caught real mistakes, both fixed: a wrong `describeMachinesError` import (it lives in `components/machines/errors`, not `components/ais/errors`) and `react(immutability)` on `translateX.value` after I inlined the pan factory into the hook (restored the factory function).
- No standalone test file was run: none of the folded movers has a test, and the only listed test (`share-intent.test.ts`) belongs to the skipped row. `pnpm gate` ran the mobile package tests (`PASS`).

### Notes for the lead

- **Rules conflict:** `apps/mobile/src/lib/machines-api.ts` is both an explicit row host in the Allowed files and covered by "do not touch any `apps/mobile/src/lib/*-api.ts`". I treated the explicit row and Allowed entry as authoritative and only moved `rawRequest` into it, with no logic change; please confirm that is what you intended.
- `message-bubble.tsx` is the one row that grows lines (+5) because the host already imports React Native's `Animated`, so reanimated's default and named imports add lines. It still removes a file and the overall target is met (−61).
- Lead smoke targets: profile page, Edit Dev-1 (computer picker + machine change), share sheet (untouched), Settings → Stickers pack cards, swipe-to-reply, attach sheet gallery, topic info sheet links.

## Review (written by Claude)

Approved; the pre-review was clean (0 findings). Net −61.

**Folded into their only importer (8 files):**
- the computer picker and machine change into `ais/[id].tsx`;
- the pack card into `settings/stickers.tsx`;
- swipe-to-reply into `message-bubble.tsx`;
- the gallery grid into `attach-sheet.tsx`;
- the topic link row into `topic-info-sheet.tsx`;
- the profile type into `u/[handle].tsx`;
- `raw-request` into `machines-api.ts`.

**Skipped:** `share-intent` keeps its own test.

**Comments:** the mover headers were condensed onto the moved code (profile `bio`, gallery grid, machine change, topic link row); none were dropped.

**Phone emulator smoke passed:** Marta's profile, Edit Dev-1, Stickers. Ana's chat: swipe-to-reply opens "Reply to Ana", and the attach sheet shows the gallery grid with the camera tile, durations and pick circles. The topic chat renders.
