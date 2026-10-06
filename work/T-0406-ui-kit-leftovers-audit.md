---
id: T-0406
title: "Audit: every hand-rolled button, field and loading/error/empty state left outside the web and mobile UI kits"
status: merged
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

### What I did
Wrote `docs/audit/ui-kit-leftovers.md` (docs only, no code). It has a Web part and
a Mobile part, each with the four tables, plus suggested batches (web first).

- **Method:** scanned every `*.tsx`/`*.ts` under `apps/web/src` and
  `apps/mobile/src` for raw `<button>`, `<a>`, `Link`, `<Pressable>`,
  `<TouchableOpacity>`, `<input>`, `<textarea>`, `<TextInput>`,
  `ActivityIndicator` and `Loader2`, then read each cited line with context.
  Test coverage was computed by resolving imports and following importers one
  level up, per `docs/LEAD_HANDOFF.md`; test paths are relative to each app's
  `src/`.
- **Web:** 16 button/link rows, 16 loading/error/empty rows, 4 text-field rows,
  9 kept-by-design lines.
- **Mobile:** 65 button rows (grouped per file), 39 loading/error/empty rows,
  no field leftovers (all four raw `TextInput`s are the kept ones), 14
  kept-by-design lines.
- T-0405's three files (`(tabs)/ais.tsx`, `ais/[id].tsx`,
  `settings/approvals.tsx`) are excluded from the state tables, as asked.

### Files changed (2)
- `docs/audit/ui-kit-leftovers.md` (new)
- `work/T-0406-ui-kit-leftovers-audit.md` (status + Report)

### Commands and real results
- `pnpm install`: exit 0, "Done in 14.3s using pnpm v10.32.1" (one pre-existing
  peer warning in `apps/mobile`, unrelated).
- No single test files were run: the change is documentation only.
- `pnpm gate` (repo root): exit 0. Summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (11.8s)
  PASS  lint  (0.9s)
  PASS  typecheck  (1.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations from the spec
The spec's buttons category says "raw `Pressable` acting as a button". I kept
table 1 to controls that act as a **button / icon button / menu item / chip**,
and documented in the doc's method section that navigation rows, cards, tabs,
radios, checkboxes, switches, grid/emoji cells, modal backdrops and inline text
links are **not** buttons. Those either belong to another kit component
(`ListRow`, `Card`, `SegmentedControl`, `Switch`, `Checkbox` — so they are a
different migration than buttons) or are kept. This keeps the requested
3-5-row batches actionable. If you want the raw navigation rows listed as their
own table too, say so and I will add it; the main raw-row files are already
named in the kept/out-of-scope lines of the doc.

### Problems
None. The kit guards (`no-accent-pill.test.ts`, `no-solid-pill.test.ts`) already
pass, so no solid accent/danger pill is left; the audit lists the non-accent
leftovers (ghost/outline/icon keys, chips, menu items) plus states and fields.

### Blocked / needs a decision
None.

### Open questions
- Should the two platforms' chips (web `ReactionChips`/scoped search chip, mobile
  reaction chips) get a shared `Chip` component, or stay as they are? The audit
  records them with "none — no `Chip` in the kit".
- The web and mobile skeletons (`Skeleton.tsx`, `MachineListSkeleton.tsx`,
  `ApprovalsListSkeleton.tsx`, `AiActivity.tsx`) may be intentional better UX
  than a `StateMessage` spinner; the audit lists them as loading states not on
  `StateMessage` but a decision to keep skeletons is reasonable.

### Round (fix round after pre-review)
- **Finding 1 (should-fix): fixed.** `docs/audit/ui-kit-leftovers.md` rows
  `ToolDetailPanel.tsx:273` and `:312` said "none found"; both now cite
  `components/tools/tools.test.tsx`, which renders them through `ToolsSection`
  (`tools.test.tsx:252` opens "Show source of v1"; `:267` types into
  "Run input (JSON)").
- **Findings 2, 3, 4 (nits): not touched.** The fix-round rule is to leave nits
  alone unless they fall on a line already changed; none of them does. Finding 2
  (`MessageActionsMenu.tsx:58` qualifier) is at line 51, finding 3 (mobile "65"
  vs 66 rows) is in this Report's "What I did", finding 4 (batch sizes at
  `docs/audit/ui-kit-leftovers.md:373,390`) is in the batches section.
- **Tests added:** none. This is a documentation-only change; finding 1 names an
  existing test file to cite, not a new test, and no behaviour changed.
- **Commands:** no single test file was run (no test code changed). `pnpm gate`
  from the repo root, exit 0:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (11.7s)
  PASS  lint  (0.6s)
  PASS  typecheck  (0.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- `status` stays `review`.

## Review (written by Claude)

**2026-10-06, lead:** approved after 1 automatic round. I spot-checked 4 citations: `ChatHeader.tsx:139`, `SearchBar.tsx:55`, `MessageList.tsx:202` and `MentionPicker.tsx:30`. All are exact. Two nits are accepted:
- the mobile button count is off by one;
- three mobile batches are over 5 rows. The lead splits them when writing specs.
