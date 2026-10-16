---
id: T-1632
title: "Docs only: re-check the open/partly rows of docs/audit/findings-sweep-client.md against today's main (WUX-27 is already fixed) and rewrite the table with current status and file:line evidence"
status: merged
milestone: M5
branch: task/T-1632-client-findings-resweep
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1632: Fresh status for the open client findings

## Spec (written by Claude, do not edit)

### Why
`docs/audit/findings-sweep-client.md` (T-1433, 2026-10-15) is out of date. For example, WUX-27 (`:58`) says "a non-image or mixed pick still keeps only the first file". But `apps/web/src/components/composer/useComposerAttachments.ts:110-135` now stages up to ten files of any kind, each tagged by `classify`.

The lead needs an accurate list to plan the next waves. **Docs only. No code.** The server twin of this task is T-1630.

### Facts (the lead read them on 2026-10-16)
- **The rows to re-check:** the table at `docs/audit/findings-sweep-client.md:20-80`. They include UI-15, MUX-13, MUX-17 to MUX-24, MUX-26, MUX-27, WUX-10, WUX-14, WUX-17, WUX-18, WUX-27, WUX-39 and WUX-44, plus any other row marked `open` or `partly`.
- **The doc's statuses** (`:7-11`): fixed, open, partly, not actionable.

### Steps
1. **Re-check each `open` and `partly` row** against today's code. Find the code by searching (line numbers move), and update its status with `file:line` evidence and the task id when a comment names one.
2. **For each row still `open` or `partly`,** add one short tag in the last column:
   - `behaviour`: a fix with no visual change;
   - `visual`: needs a design canvas first;
   - `decision`: needs Julio.
3. **Update the summary counts.** Keep the doc's format, and date the re-check 2026-10-16.

### Allowed files
- `docs/audit/findings-sweep-client.md`
- `work/T-1632-client-findings-resweep.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Every `open` or `partly` row has fresh `file:line` evidence and a tag.**
- **No source files change.**

---

## Report (written by the worker when done)

### What I did

Docs-only re-check of `docs/audit/findings-sweep-client.md` against today's `main`
(2026-10-16), per the Spec. No source file changed.

I re-checked every `open` and `partly` row by searching for the code it cites (line numbers
have moved) and reading it. I rewrote the table with current statuses and fresh `file:line`
evidence, added a `tag` column (the new last column) filled for every row still `open` or
`partly`, updated the counts, and replaced the old "Updates after the sweep" note with a
"Changes since the sweep" list.

Row moves (table + counts):

- **partly → fixed:** MUX-17, MUX-22, MUX-27, WUX-27, WUX-44.
- **open → fixed:** MUX-18, MUX-20, MUX-24, WUX-17, WUX-18.
- **partly → not actionable:** MP-9 (lead's 2026-10-15 Telegram-rules decision, already in its row).

Evidence highlights (fresh `file:line`):

- WUX-27: `apps/web/src/components/composer/useComposerAttachments.ts:110-135` now stages up
  to ten files of any kind, each tagged by `classify` — the spec's example. Fixed.
- MUX-17: `apps/mobile/src/components/ui/search-field.tsx:55` adds `hitSlop={12}`; that was the
  only remaining item. Fixed.
- MUX-18: `apps/mobile/src/components/ui/text.tsx:66,74` caps at `MAX_FONT_SCALE = 1.4` and the
  fixed heights became minimums (`chat-list-item.tsx:91`, `chat-header.tsx:159`). Fixed.
- MUX-20: all three auth screens use `KeyboardAvoidingView` (`AuthFlow.tsx:153-156`,
  `NameForm.tsx:63-64`, `welcome/handle.tsx:139-140`). Fixed.
- MUX-22: send (`composer-input-row.tsx:169`) and quick reactions
  (`message-actions-sheet.tsx:147`) call `tap()`. Fixed.
- MUX-24: `apps/mobile/app.json:21` is now `predictiveBackGestureEnabled: true`. Fixed.
- MUX-27: `apps/mobile/src/components/chat/empty-chat.tsx` is a purpose-built empty state;
  an AI chat shows clickable suggestion chips (`:70-94`). Fixed.
- WUX-17: `apps/web/src/lib/handleGate.ts:4-13,37-51` uses `localStorage` keyed per user. Fixed.
- WUX-18: `apps/web/src/routes/JoinPage.tsx:19-27` `JoinChecking` uses `useDelayed` + the loading
  `StateMessage`. Fixed.
- WUX-44: `apps/web/src/App.tsx:15,31` + `apps/web/src/lib/push.ts:120,133` wire
  `useServiceWorkerUpdate`. Fixed.

Still `open`: **UI-15** (pins still timer-based, no realtime channel — `polling.ts:16-21,161-175`,
`pins.ts:1`) and **MUX-19** (VIEW-only intent filters, no share library, no `/share` route).
Both tagged `behaviour`.

Still `partly`: MUX-13 (`behaviour`), MUX-21 (`visual`), MUX-23 (`behaviour`), MUX-26
(`behaviour`), WUX-10 (`visual`), WUX-14 (`behaviour`), WUX-39 (`decision`).

Final counts: **fixed 42, partly 7, open 2, not actionable 6 (total 57)**.

### Checks run

`pnpm install` — Done in 16.9s (pnpm v10.32.1).

`pnpm gate` (from the repo root) — summary:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (2.0s)
PASS  format  (0.9s)
PASS  lint  (1.6s)
PASS  typecheck  (1.5s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

The two changed files are `docs/audit/findings-sweep-client.md` and this task file, both in
Allowed files. No test files were touched, so no single test was run (`pnpm gate` skipped the
`effect` package tests as no source changed).

### Notes for the lead

- The task said "add one short tag in the last column". I added a new last column named `tag`
  (the previous last column was `area`, which holds file lists, not tags).
- Tag choices for the remaining rows: `MUX-21` (anchor the message menu to the bubble) and
  `WUX-10` (in-aside settings on wide screens) are layout work → `visual`. `WUX-39` is
  `decision` because on the web, notification sound/vibration are browser-controlled, so
  whether to offer toggles is a product call. The other open/partly rows are `behaviour`.
- I judged MUX-27 `fixed`: the messages empty state is now a dedicated component (T-1511/
  T-1520) with clickable AI suggestion chips. A non-AI DM/group still shows only the
  "No messages yet" hint, which I read as the intended design rather than the old defect;
  flag it if you want it kept as `partly`.
- I changed the doc's final section header from "Updates after the sweep (lead, 2026-10-15)" to
  "Changes since the sweep" and folded the 2026-10-15 updates into the table and counts, dated
  2026-10-16. The MP-9 Telegram-rules decision is preserved in its row.

## Review (written by Claude)

**Approved and merged** (docs only).

- **Pre-review:** clean.
- **The client sweep now reads:** 42 fixed, 7 partly, 2 open, 6 not actionable, of 57.
  - **Behaviour work left:** UI-15 (pins poll), MUX-13 (Share in the viewer), MUX-19 (share intent), MUX-23 (push reply and grouping), MUX-26 (copy strings) and WUX-14 (offline composer).
  - **Visual (needs a canvas):** MUX-21 and WUX-10.
  - **Julio's decision:** WUX-39.
- **The lead's own commit** also refreshes `docs/FEATURES.md`:
  - AI computers are now live (it said "Planned");
  - tools, routines, web tools and host approval are on by default since T-1613;
  - the server foundation row names Effect Schema and `migrateSql` instead of zod and Drizzle.
