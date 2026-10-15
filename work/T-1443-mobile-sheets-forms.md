---
id: T-1443
title: "Mobile sheets follow the approved New AI standard (part 1): Telegram import, Add machine, New topic, New channel, Forward, New topic (group picker) move to the kit BottomSheet with a header close key and one primary in the sticky footer"
status: merged
milestone: M5
branch: task/T-1443-mobile-sheets-forms
model: auto
effort: default
depends_on: [T-1432]
estimate: 0.5 day
---

# T-1443: Mobile sheets on the standard (part 1)

## Spec (written by Claude, do not edit)

### Why
Julio approved the New AI redesign on 2026-10-15 (`docs/design/mockups/new-ai/README.md`, "Rules the design set"):
- **One way out:** the close key (or the grabber, the backdrop or Android back);
- **one primary** in the footer;
- **lean:** no new subtitles or hints.

T-1432 built the parts into the kit `BottomSheet`. Other sheets still use the old style: their own `Modal`, an inline `Cancel` + `Create` row inside the scroll body, and the old `bg-background` or `bg-surface` cards. This task moves six of them onto the standard. **Only layout and chrome change**: behaviour, copy and data stay the same.

### Facts (the lead read them on main, 2026-10-15)
- **The kit `BottomSheet`** is `apps/mobile/src/components/ui/bottom-sheet.tsx`. Its props:
  - `visible`, `onClose`, `closeLabel`;
  - `title`;
  - `onBack`;
  - `headerRight` (keys on the header's right);
  - `footer` (a sticky row under the scroll view, kept above the keyboard);
  - `maxHeightClassName`.
  - It is the native sheet (drag, backdrop and Android back close it) on the D24 panel.
- **The reference usage** is `apps/mobile/src/mock/dev-kit-screen.tsx:314-351`: `headerRight` is an `IconButton` with `label="Close"`, `className="h-9 w-9 rounded-xl"` and lucide `X` size 16, and `footer` is a single `Button`.
- **The six sheets:**
  - `apps/mobile/src/components/stickers/telegram-import-sheet.tsx` (333 lines): its own `Modal` (`:124`) with a hand-made handle and `bg-background` card (`:134-136`), a title row with a Close key, and inline `flex-row justify-end` button rows (`:163`, `:174`, plus the rows near `:210-235` and `:307-320`). Used by `apps/mobile/src/app/settings/stickers.tsx`.
  - `apps/mobile/src/components/machines/add-machine-sheet.tsx` (133 lines): a centered `Modal` card (`:59-64`), "Add machine", with Close and Done keys (`:75`, `:123`). Used by `apps/mobile/src/app/settings/machines.tsx`.
  - `apps/mobile/src/components/chat/new-topic-sheet.tsx` (272 lines): already a `BottomSheet` (`:99`), with an inline Cancel + Create row (`:258-268`).
  - `apps/mobile/src/components/chat/new-channel-sheet.tsx` (136 lines): an inline Cancel + "Create channel" row (`:126-133`). Find where it's rendered (it may sit inside another sheet) and keep that.
  - `apps/mobile/src/components/chat/forward-sheet.tsx` (147 lines): a `BottomSheet` (`:95`) with an inline Cancel + Send row (`:137-144`).
  - `apps/mobile/src/components/chat/new-topic-group-sheet.tsx` (189 lines): a `BottomSheet` (`:159`), a list of groups with no footer.

### What to build
0. **Kit:** in `apps/mobile/src/components/ui/bottom-sheet.tsx`, when `title` is given and `headerRight` is `undefined`, render the close `IconButton` from the reference by default:
   - it calls `onClose`, and its label is `closeLabel`;
   - `headerRight={null}` hides it;
   - so every titled sheet in the app gets the same close key.
   - Update `apps/mobile/src/mock/dev-kit-screen.tsx` only if it now shows two close keys.

The same rules then apply to every sheet:
1. Each sheet renders the kit `BottomSheet` with its current title as `title`, and relies on the default close key. Replace a sheet's own `Modal`, handle and card with it.
2. The inline action row goes away:
   - its **one** primary action becomes `footer={<Button …>}`, full width, with the same label, disabled rule and busy label;
   - the **Cancel / Close / Done** keys are removed (the close key and the native gestures close the sheet).
   - When the only key in a state was Close or Done (the add-machine code screen, the Telegram import's finished state), that state has no footer.
3. When a sheet has steps (Telegram import: pick, then progress, then result), keep the steps. Where the current code has a Back key, use `onBack` on the header.
4. Errors stay where they are, in the body above the footer.
5. Change no copy, apart from removing those keys.
6. Each file stays at 400 lines or fewer. Remove imports that are no longer used.

### Tests
None (UI).

### Allowed files
- `apps/mobile/src/components/ui/bottom-sheet.tsx`, `apps/mobile/src/mock/dev-kit-screen.tsx`
- `apps/mobile/src/components/stickers/telegram-import-sheet.tsx`, `apps/mobile/src/components/machines/add-machine-sheet.tsx`
- `apps/mobile/src/components/chat/new-topic-sheet.tsx`, `apps/mobile/src/components/chat/new-channel-sheet.tsx`, `apps/mobile/src/components/chat/forward-sheet.tsx`, `apps/mobile/src/components/chat/new-topic-group-sheet.tsx`
- `apps/mobile/src/app/settings/stickers.tsx` and `apps/mobile/src/app/settings/machines.tsx`, only if a prop must change
- `work/T-1443-mobile-sheets-forms.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The lead's phone smoke opens the sticker settings and machines screens, and a chat's new topic and forward sheets.

---

## Report (written by the worker when done)

### What I did

**Kit (`bottom-sheet.tsx`).** When `title` is given and `headerRight` is `undefined`, the header now renders the reference close key by default: an `IconButton` labelled `closeLabel` (`h-9 w-9 rounded-xl`) with lucide `X` size 16, calling `onClose`. `headerRight={null}` hides it; any node replaces it. The doc comment records it. `dev-kit-screen.tsx` needed no change: its reference sheet passes an explicit `headerRight`, so it does not gain a second close key (the other titled sheet gains one, which is the intent).

**The six sheets** (layout/chrome only; copy, data and behaviour kept):

1. `telegram-import-sheet.tsx` — its own `Modal`, hand-made handle and `bg-background` card are replaced by the kit `BottomSheet` (`title` per step; close key from the kit). Inline button rows are gone. Footer: the pick step's primary `Import` (busy label `Importing…`); the result step's primary `Open pack`, with `Import again` (only while `result.partial`) beside it; the `not-set-up` and `token-rejected` states have no footer (their only key was Close). Errors stay in the body. `onDone` still fires on every exit after a result (close key and Open pack), so My packs still reloads after an import. 333 → 264 lines.
2. `add-machine-sheet.tsx` — the centered `Modal` card is replaced by the kit sheet, `title="Add machine"`. Footer: `Try again` in the error state; the loading and code states have no footer (the code screen's only key was Done). 133 → 123.
3. `new-topic-sheet.tsx` — already a `BottomSheet`; the `Cancel` + `Create` row is gone and `Create` is the footer.
4. `new-channel-sheet.tsx` — its own card is replaced by the kit `BottomSheet` (`title="New channel"`); `Cancel` removed, `Create` in the footer. It has no `visible` prop, so it renders `<BottomSheet visible …>` and is mounted/unmounted by its parent exactly as before.
5. `forward-sheet.tsx` — the `Cancel` + `Send` row is gone and `Send` is the footer.
6. `new-topic-group-sheet.tsx` — already met the standard (kit `BottomSheet`, `title="New topic"`, group list, no footer), so it needed no edit; it gains the default close key from the kit change.

### Files changed

- `apps/mobile/src/components/ui/bottom-sheet.tsx`
- `apps/mobile/src/components/stickers/telegram-import-sheet.tsx`
- `apps/mobile/src/components/machines/add-machine-sheet.tsx`
- `apps/mobile/src/components/chat/new-topic-sheet.tsx`
- `apps/mobile/src/components/chat/new-channel-sheet.tsx`
- `apps/mobile/src/components/chat/forward-sheet.tsx`
- `work/T-1443-mobile-sheets-forms.md`

(`new-topic-group-sheet.tsx`, `dev-kit-screen.tsx`, `app/settings/stickers.tsx` and `app/settings/machines.tsx` needed no change.)

### Commands

- `pnpm install` — Done (11.8s), no lockfile change.
- `pnpm exec prettier --write apps/mobile/src/components/stickers/telegram-import-sheet.tsx` — fixed the one formatting issue the first gate flagged.
- `pnpm gate` (repo root), final run:

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.0s)
PASS  lint  (0.7s)
PASS  typecheck  (2.3s)
PASS  effect  (0.4s)
PASS  tests @zilar/mobile  (0.9s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test files were run: no test file sits near the changed components (`grep` over `*.test.*` in `apps/mobile` found none) and the spec says UI gets none; the gate ran `@zilar/mobile`'s own tests, all passing.

### Deviations / notes / open questions

1. **Telegram result-state footer (needs your call).** The rule "when the only key in a state was Close or Done, that state has no footer" fits the add-machine code screen and the Telegram `not-set-up` / `token-rejected` states, whose only key is Close. The spec also lists "the Telegram import's finished state" as such a state, but the code shows it is not: it has `Open pack` (variant `default`, the primary), `Done`, and `Import again` when the import was partial. Because the spec's hard rule is "behaviour … stay the same", I kept the primary `Open pack` in the footer (with `Import again` beside it only for a partial import) and removed only `Done`. If you truly meant the finished state to have no footer, and Open pack to live elsewhere, say so and I will change it — but as written the sheet would lose the way to open the imported pack and the reload on close.
2. **New channel sits inside a dialog.** `NewChannelSheet` is rendered inside an RN `Modal` in `apps/mobile/src/components/chat/new-chat-button.tsx:216-266`; that file is not in the Allowed files and the spec says to keep where it is rendered, so I kept it. Consequence: the parent `Modal` now shows only its `bg-black/40` backdrop behind the native sheet (a second dim layer plus an extra outside-tap-to-close area). Removing that wrapper means editing `new-chat-button.tsx`; say the word and I will do it as a follow-up.
3. **Busy import and native dismiss.** The old Telegram sheet disabled its backdrop and close key while an import ran. The kit's `TrueSheet` is always `dismissible`, so a drag / backdrop / Android back during a busy import dismisses the sheet even though `close()` ignores it while busy (the sheet then stays hidden while `visible` is still true). The kit has no `dismissible` switch and the spec's kit change was only the default close key, so I did not add one.
4. The Telegram title now renders on the kit's single header line (the old title allowed two lines for a long pack title); the copy is unchanged.
5. Inner content boxes (the Telegram summary card, the add-machine code box) keep their existing `bg-surface` styling; only the sheet shell chrome changed.

### Round (fix round for PREREVIEW.md)

- **Finding 1 (must-fix) — fixed.** `BottomSheet` gained a `dismissible?: boolean` prop (default `true`) that is passed through to `TrueSheet`, so a caller can block the native drag, backdrop tap and Android back. `TelegramImportSheet` now passes `dismissible={!busy}`: while an import runs, a drag, a backdrop tap or Android back no longer dismisses the native sheet, so `visible` cannot stay `true` while the panel is gone and the present/dismiss effect (`useEffect` on `[visible]`) never needs to re-present. The old sheet's "disabled backdrop and X while busy" behaviour is restored (the header close key is still a no-op while busy through `close()`'s guard).
- Nits 3 and 4 left untouched: they sit in lines this round did not change (`variant` of `Import again`, the kit's default close key). Finding 2 / follow-up F1 (the parent `Modal` around `NewChannelSheet` in `new-chat-button.tsx`) needs a file outside the Allowed files and was left as the reported follow-up.
- **Tests added: none.** The finding names no test, the spec says "Tests: None (UI)", AGENTS.md says UI code gets no tests, and a new test file would be outside the Allowed files (the gate's scope check would flag it). The change is pure prop plumbing on a native sheet; the lead's phone smoke and Julio's live checks cover it.
- **Gate:** re-run from the repo root after the fix — `GATE PASS` (install / format / lint / typecheck / effect / tests @zilar/mobile all PASS; scope, migration, images, size all pass; 7 changed files, all inside the Allowed files).

### Round 2 (fix round for PREREVIEW.md, fresh session)

- **Finding 1 (must-fix) — fixed (the previous round fixed the wrong sheet).** PREREVIEW finding 1 names `apps/mobile/src/components/chat/new-channel-sheet.tsx:73-83`: the New channel sheet rendered the kit `BottomSheet` without `dismissible`, while its parent guards the close (`apps/mobile/src/components/chat/new-chat-button.tsx:245-249`, `if (!channelBusy) setAction(undefined)`). The previous round instead added `dismissible={!busy}` to `telegram-import-sheet.tsx`, so the named finding was still open. This round `NewChannelSheet` now passes `dismissible={!busy}`: while a create runs, a drag, a backdrop tap or Android back no longer dismisses the native sheet, so `visible` (always `true` while the parent mounts the sheet) cannot desync from a natively dismissed panel; the parent's guarded `onClose` therefore runs only when not busy. The Telegram sheet's `dismissible={!busy}` from the previous round is kept.
- Should-fix: none.
- Nits 2, 3 and 4 left untouched: they sit in lines this round does not change (`telegram-import-sheet.tsx` and `bottom-sheet.tsx`). Follow-up F1 (the parent `Modal` around `NewChannelSheet`) still needs a file outside the Allowed files.
- **Tests added: none.** The finding names no test; the spec says "Tests: None (UI)"; AGENTS.md says UI code gets no tests; and a new test file would sit outside the Allowed files, which the gate's scope check would flag. The change is one prop on a native sheet, covered by the lead's phone smoke.
- **Gate** (repo root, after the fix):

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (1.1s)
PASS  lint  (0.9s)
PASS  typecheck  (3.9s)
PASS  effect  (0.7s)
PASS  tests @zilar/mobile  (2.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

No single test files were run: no test file sits near the changed components and the finding/spec call for none.

## Review (written by Claude)
Lead, 2026-10-15: approved after 2 auto rounds (native dismiss blocked while busy). Pre-review CLEAN, nit 2, follow-up 1.
- Phone smoke PASS on `/settings/stickers`, `/settings/machines` and a chat.
- The lead opened Add machine on the emulator: it is a hugging kit sheet with a title and the default close key, and no Close or Done key.
- Follow-up: the parent `Modal` around `NewChannelSheet` in `new-chat-button.tsx` goes into the mobile sheets part 2 task.
