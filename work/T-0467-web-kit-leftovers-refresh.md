---
id: T-0467
title: "Audit: refresh the web half of the UI kit leftovers list (what is still hand-rolled on web today), with ready batches"
status: todo
milestone: M5
branch: task/T-0467-web-kit-leftovers-refresh
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0467: web kit leftovers, refreshed

## Spec (written by Claude, do not edit)

### Why
`docs/audit/ui-kit-leftovers.md` (T-0406, 2026-10-06) is the source list for moving web UI onto the kit (`apps/web/src/components/ui/`). Many rows are done now: for example `MessageSearchResults.tsx`, `ApprovalsPage.tsx` and `PeopleSearchResult.tsx` already use `StateMessage`. The list is stale. Julio wants the web kit cleanup next.

This task rewrites the **web** part so every row is still true today. **Docs only: no code changes.**

### Verified facts (do not re-derive)
- **The doc's method** is in `docs/audit/ui-kit-leftovers.md:21-30`: scan for raw `<button>`, `<a>`, `Link`, `<input>`, `<textarea>`, `Loader2`; read each line with context; find tests one importer level up.
- **The suggested web batches** are at `docs/audit/ui-kit-leftovers.md:296-333` (W-menu … W-fields).
- **Web kit files:** `badge`, `button`, `card`, `checkbox`, `dialog`, `icon-button`, `list-row`, `menu` (`MenuItem`, `MenuRadioItem`), `search-field`, `segmented-control`, `sheet`, `state-message`, `switch`, `text-input` (`TextInput`, `TextArea`, `SecretInput`) and `well`.
- **A quick count on main today** still shows raw elements in, among others:
  - `components/PinsPanel.tsx`: 2 `<button>`;
  - `components/FolderEditorDialog.tsx`: 1 `<input>`, 1 `<button>`;
  - `components/SearchBar.tsx`: 1 `<input>`, 1 `<button>`;
  - `routes/FoldersPage.tsx`: 2 `<button>`;
  - `components/ChatHeader.tsx`: the title `<button>`;
  - `components/PinnedBanner.tsx`: the jump `<button>`;
  - `components/MentionPicker.tsx` and `components/ReactionChips.tsx`.
- **Not a kit candidate:** `MentionPicker`'s rows are `role="option"` in a listbox. `MenuItem` is `role="menuitem"`, so it does not fit.

### What to write
Replace **only the web sections** of `docs/audit/ui-kit-leftovers.md`. Keep the mobile sections untouched, and update the header date and task id. The web part has these sections:
1. **Still hand-rolled on web:** one row per raw element in `apps/web/src` (not under `components/ui/`, not tests or fixtures), giving the `file:line`, what it is, the kit component it should become (or "keep", with a one-line reason: a listbox option, a link-styled text button, a full-row composite and so on), and the test file(s) that cover it.
2. **Done since T-0406:** the rows from the old list that are now on the kit, each with one line.
3. **Ready batches:** groups of 3-5 rows that share files or tests, each small enough for one task. For each batch give the exact files, the kit component, and the test files to extend. Order them by value: the most visible screens first. Mark any batch that needs a new kit component, such as a `Chip` for reactions or the search filter chips, as "needs a kit decision".

### Read first
`AGENTS.md`, `docs/audit/ui-kit-leftovers.md`, every file in `apps/web/src/components/ui/` (props only).

### Allowed files
`docs/audit/ui-kit-leftovers.md`, `work/T-0467-web-kit-leftovers-refresh.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The web part of `docs/audit/ui-kit-leftovers.md` lists only rows that are true on main today (each with a `file:line` that was read), a done list, and ordered ready batches.
- The mobile part is unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
