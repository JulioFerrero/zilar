---
id: T-1663
title: "Phone: archiving a topic for everyone asks first, like web (parity audit gap 3, first half) — both entry points (the topic-info sheet's Archive topic and the group screen's long-press 'Archive topic for everyone') close their sheet and open a ConfirmDialog with web's copy"
status: merged
milestone: M5
branch: task/T-1663-confirm-archive-topic
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1663: Confirm before archiving a topic on the phone

## Spec (written by Claude, do not edit)

### Why
On web, "Archive topic for everyone" asks first (`apps/web/src/components/ChatHeader.tsx:323-334`). On the phone, both entry points archive at once on a single tap (`docs/audit/parity-2026-10-16.md`, gap 3).

### Facts (the lead read them on 2026-10-16)
- **Web's copy:**
  - the title is `Archive “${chat.title}” for everyone?`;
  - the body is "The topic disappears from the list for everyone. Its history stays on the server.";
  - the confirm label is "Archive".
- **`apps/mobile/src/components/ui/confirm-dialog.tsx`:** `ConfirmDialog` props `visible`, `title`, `message`, `error?`, `confirmLabel`, `busyLabel`, `busy`, `onCancel`, `onConfirm`, `confirmAccessibilityLabel?` and `destructive?` (default true). Usage example: `apps/mobile/src/app/settings/sticker-pack.tsx:165-177`, where a sheet closes itself (`setSelection(null)`) before its action.
- **Entry point 1, the topic-info sheet:** `apps/mobile/src/components/chat/topic-info-host.tsx` (126 lines).
  - `onArchive` (`:49-57`) sets busy, calls `patchTopic(chat.id, { archived: true })`, closes the sheet on success (`screen.setInfoOpen(false)`) and sets `screen.setInfoError('Could not archive the topic. Try again.')` on failure.
  - It's passed to `TopicInfoSheet` as `onArchive` (`:89`); the button is at `apps/mobile/src/components/chat/topic-info-sheet.tsx:359-361`.
- **Entry point 2, the group screen:** `apps/mobile/src/app/group/[id].tsx` (297 lines).
  - `const [archiveState, runArchive] = useAction((chatId) => …archiveTopic(chatId)…)` (`:122-133`) closes the sheet on success and sets `setSheetError('Could not archive the topic. Try again.')` on failure;
  - `runSheetAction` (`:156-163`) calls `runArchive(chat.id)` for the long-pressed `sheetFor` chat;
  - the error banner is rendered at `:276-280` when `sheetError !== ''`.

### Steps
1. **`topic-info-host.tsx`:**
   - add `const [confirmingArchive, setConfirmingArchive] = useState(false)`;
   - pass `TopicInfoSheet` a new handler that closes the info sheet (`screen.setInfoOpen(false)`) and sets `confirmingArchive` to true;
   - render a `ConfirmDialog` with web's copy, the confirm label "Archive", the busy label "Archiving…", `busy={screen.infoBusy}` and `error={screen.infoError}`;
   - `onConfirm` runs today's archive call. On success it closes the dialog; on failure it keeps the dialog open with the error;
   - `onCancel` (when not busy) closes the dialog and clears the error.
2. **`app/group/[id].tsx`:**
   - add `const [confirmArchive, setConfirmArchive] = useState<ChatSummary | null>(null)`;
   - `runSheetAction` stores `sheetFor` there and closes the sheet (`setSheetFor(null); setSheetMuteOpen(false)`) instead of archiving;
   - render a `ConfirmDialog` with web's copy for `confirmArchive.title`, `busy={isWaiting(archiveState)}` and `error={sheetError}`;
   - `onConfirm` calls `runArchive(confirmArchive.id)`;
   - `runArchive`'s success tap also clears `confirmArchive`;
   - `onCancel` (when not busy) clears it and `sheetError`;
   - show the bottom error banner only while `confirmArchive === null`, so the error isn't shown twice.
3. **Keep each file within 400 lines. No tests** (UI).

### Allowed files
- `apps/mobile/src/components/chat/topic-info-host.tsx`
- `apps/mobile/src/app/group/[id].tsx`
- `work/T-1663-confirm-archive-topic.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Both phone entry points ask before archiving a topic for everyone,** with web's copy. Cancel does nothing.
- **A failed archive shows its error in the dialog.**
- **The per-user Archive/Unarchive chat action is unchanged** (no confirm).

---

## Report (written by the worker when done)

### What I did

Both phone entry points now confirm before archiving a topic for everyone, using web's
copy (`Archive “<title>” for everyone?` / "The topic disappears from the list for everyone.
Its history stays on the server." / confirm "Archive", busy "Archiving…").

- `apps/mobile/src/components/chat/topic-info-host.tsx`
  - Added `const [confirmingArchive, setConfirmingArchive] = useState(false)`.
  - `TopicInfoSheet`'s `onArchive` is now `onAskArchive`, which clears the error, closes the
    info sheet (`screen.setInfoOpen(false)`) and sets `confirmingArchive` true instead of
    archiving at once.
  - The old `onArchive` body stays the actual archive call and is now the dialog's
    `onConfirm`; on success it closes the dialog (`setConfirmingArchive(false)`), on failure it
    keeps it open and shows `screen.infoError`.
  - Renders a `ConfirmDialog` (title/message above, `confirmLabel="Archive"`,
    `busyLabel="Archiving…"`, `busy={screen.infoBusy}`, `error={screen.infoError}`);
    `onCancel` clears the dialog and the error only when not busy.
- `apps/mobile/src/app/group/[id].tsx`
  - Added `const [confirmArchive, setConfirmArchive] = useState<ChatSummary | null>(null)`.
  - `runSheetAction` now stores the long-pressed chat in `confirmArchive` and closes the sheet
    (`setSheetFor(null); setSheetMuteOpen(false)`) instead of archiving.
  - Renders a `ConfirmDialog` for `confirmArchive.title` with `busy={isWaiting(archiveState)}`
    and `error={sheetError}`; `onConfirm` runs `runArchive(confirmArchive.id)` and `onCancel`
    (when not busy) clears `confirmArchive` and `sheetError`.
  - `runArchive`'s success tap also clears `confirmArchive`.
  - The bottom error banner renders only while `confirmArchive === null`, so a failed archive
    shows its error once, inside the dialog.

The per-user Archive/Unarchive chat action is untouched: it still goes through `onPref` →
`runSheetPref`, which never sets `confirmArchive`.

Both files stay well under 400 lines (host 153, group screen ~320).

### Checks run

- `pnpm install` — done in 13.9s (1 deprecated subdep warning, peer warning for
  `@types/react-dom`, both pre-existing).
- No package test file covers these two components (searched for `TopicInfoHost`,
  `runSheetAction`, `Archive topic for everyone` under `apps/mobile/src`); the change is
  UI-only, so per AGENTS.md no tests were added and no single test file was run.
- `pnpm gate` from the repo root:

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (1.5s)
PASS  lint  (1.0s)
PASS  typecheck  (3.5s)
PASS  effect  (0.6s)
PASS  tests @zilar/mobile  (1.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

Files changed (all in Allowed files): `apps/mobile/src/components/chat/topic-info-host.tsx`,
`apps/mobile/src/app/group/[id].tsx`, `work/T-1663-confirm-archive-topic.md`.

### Notes for the lead

- One small addition beyond the literal spec steps: `onAskArchive` also clears
  `screen.infoError` before opening the dialog, so a stale error from a previous failed
  action can't bleed into the dialog. The spec's `onCancel` clear is kept too.
- I verified in `topic-actions-sheet.tsx` that `onAction('archive')` (Archive topic for
  everyone) is the only caller of `runSheetAction`, and that the per-user Archive/Unarchive
  goes through `onPref` (`runSheetPref`), so it is unaffected.
- Acceptance is UI behaviour; it was not smoke-tested on a device (no test runner for these
  screens), so it is worth a phone check: both entry points show the dialog, Cancel does
  nothing, a failed archive shows its error in the dialog.

### Round (fix round 1)

Findings fixed:

- **Finding 1 (must-fix):** stale `sheetError` survived a successful archive retry in
  `apps/mobile/src/app/group/[id].tsx`, so the bottom banner showed
  "Could not archive the topic. Try again." after the topic was in fact archived. The
  dialog's `onConfirm` now clears `sheetError` before each `runArchive` attempt, matching
  the sibling `topic-info-host.tsx`, whose `onArchive` clears `screen.infoError` at the
  start of every attempt.

Tests added / adjusted: none. The spec says "No tests (UI)", AGENTS.md says UI code gets
no tests, and no test file exists for these screens (`group-screen-sheets.test.tsx`
referenced in the screen's comment is not present). The finding names no test.

Commands run:

- `pnpm gate` from the repo root:

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.3s)
PASS  lint  (1.1s)
PASS  typecheck  (4.8s)
PASS  effect  (1.7s)
PASS  tests @zilar/mobile  (7.4s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

Status stays `review`.

## Review (written by Claude)

**Approved and merged.** This is parity gap 3, first half.

- **Pre-review:** clean after 1 auto round.
- **The change:**
  - both entry points (the topic-info sheet's Archive topic, and the group screen's long-press "Archive topic for everyone") close their sheet and open a `ConfirmDialog` with web's copy;
  - a failure shows in the dialog, and the error is cleared before each try;
  - the group screen's bottom banner hides while the dialog is open;
  - per-user Archive/Unarchive is unchanged.
- **Still open from gap 3:** the tappable reply quote.
- **Still to check:** the emulator check is in the combined phone QA pass.

