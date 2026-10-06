---
id: T-0406
title: "Audit: every hand-rolled button, field and loading/error/empty state left outside the web and mobile UI kits"
status: todo
milestone: M5
branch: task/T-0406-ui-kit-leftovers-audit
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0406: UI kit leftovers audit

## Spec (written by Claude, do not edit)

### Why
About 100 tasks moved the web and mobile screens onto the UI kits. The lead needs one exact list of what is left, so the next migration tasks cite real lines instead of guesses. This task writes a document only; it changes no code.

### Verified facts (do not re-derive)
- **Web kit:** `apps/web/src/components/ui/`, including:
  - `button.tsx` (`Button`) and `icon-button.tsx` (`IconButton`);
  - `state-message.tsx`;
  - `menu.tsx` (`MenuItem`, `MenuRadioItem`);
  - `text-input.tsx` (`TextInput`, `TextArea`, `SecretInput`);
  - `search-field.tsx`, `segmented-control.tsx`, `switch.tsx`, `checkbox.tsx`, `dialog.tsx`, `sheet.tsx`.
- **Mobile kit:** `apps/mobile/src/components/ui/`, including:
  - `button.tsx`, `state-message.tsx`, `segmented-control.tsx`, `switch.tsx`, `checkbox.tsx`;
  - `icon-button.tsx`, `text-field.tsx`, `search-field.tsx`;
  - `action-sheet.tsx`, `bottom-sheet.tsx`, `confirm-dialog.tsx`.

  List the folder to get the exact names.
- **Already kept raw on purpose** (list them under "Kept by design" with one line each, do not propose migrating them):
  - web: list rows, tabs, radios and grid cells; the FolderRail keys; the MessageBubble inline Retry/Delete links; the EditBar and Composer full-height strips; the TaskStrip chips;
  - mobile: the composer, OtpInput, the sticker-pack emoji cell, the folder name row with its inline counter, and the image viewer Close on its black overlay.
- **Known mobile leftovers** to confirm and include: `ActivityIndicator` is still used directly in, for example:
  - `apps/mobile/src/app/explore.tsx`, `apps/mobile/src/app/settings/profile.tsx`, `apps/mobile/src/app/(tabs)/settings.tsx`, `apps/mobile/src/app/(tabs)/profile.tsx`;
  - `apps/mobile/src/app/u/[handle].tsx`, `apps/mobile/src/app/at/[handle].tsx`, `apps/mobile/src/app/ais/new.tsx`;
  - `apps/mobile/src/components/chat/message-search-list.tsx`.

  T-0405 (running) covers `(tabs)/ais.tsx`, `ais/[id].tsx` and `settings/approvals.tsx`. Skip those three.

### What to build
Write `docs/audit/ui-kit-leftovers.md` with two parts, Web and Mobile. Under each, write tables with these columns:

| File:line | What it is today (one line, the visible text) | Kit replacement | Tests that cover it |
| --- | --- | --- | --- |

- **Tables:**
  1. **Buttons and links styled as buttons:** raw `<button>`, `<a>` or `Link` on web; raw `Pressable` or `TouchableOpacity` acting as a button on mobile. Leave out the "Kept by design" items.
  2. **Loading, error and empty states not on `StateMessage`.**
  3. **Text fields not on the kit field components.**
  4. **Kept by design:** one line each.
- **Rules:**
  - Cite every row as `file:line` that you opened and read. Do not guess.
  - For each row, name the test file that renders it (grep for importers one level up, as `docs/LEAD_HANDOFF.md` explains). Write "none found" when there is none.
  - End with **Suggested batches:** groups of 3-5 rows that share files or tests, each small enough for one task, with web batches first.

### Read first
`AGENTS.md`, `docs/audit/ui-kit-audit.md` (the first audit, for its format), `docs/LEAD_HANDOFF.md` (the section on transitive test imports), and both kit folders.

### Allowed files
`docs/audit/ui-kit-leftovers.md`, `work/T-0406-ui-kit-leftovers-audit.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `docs/audit/ui-kit-leftovers.md` exists with the four tables per platform and the suggested batches.
- Every row has a `file:line`.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
