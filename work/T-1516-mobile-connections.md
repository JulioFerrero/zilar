---
id: T-1516
title: "Phone Connections (approved canvas, twin of T-1503): one list of keys with a status dot, a muted line and ⋯; a row opens a key sheet (Test key, Replace key, Delete); no status words"
status: merged
milestone: M5
branch: task/T-1516-mobile-connections
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1516: Phone Connections

## Spec (written by Claude, do not edit)

### Why
Julio approved the Connections design on 2026-10-15. Read `docs/design/mockups/connections/README.md`, `Phone.dc.html` and `PhoneSheet.dc.html`. Web shipped as T-1503 (`apps/web/src/components/connections/ConnectionRow.tsx`, the reference for the states); this is the phone twin.
- **The header:** a 40 px Back key, a 40 px Add key, and a large title.
- **One rounded list.** Each row has a status dot (green working, red not), the provider name, a muted line, and a ⋯ glyph; the whole row opens the key's sheet. When a key fails, the line starts with the reason in red.
- **The sheet:** the dot and the name, then:
  - Test key (a green check after a passing test);
  - Replace key;
  - Delete (red).

### Facts (the lead read them on main, 2026-10-15)
- **`apps/mobile/src/app/settings/connections.tsx` (140 lines):** the list renders `ConnectionCard`s with test and two-step remove props (`:101-125`). The empty state is "No provider connections yet." (`:88-99`).
- **`apps/mobile/src/components/connections/connections-header.tsx` (38 lines):** Back, the title "Connections" with the subtitle "Provider accounts for your AIs.", and an Add `IconButton` labelled "Add a connection".
- **`apps/mobile/src/components/connections/connection-card.tsx` (132 lines):**
  - `hostOf` (`:14-17`);
  - an inline remove confirm (`:49-80`);
  - the row: the name, a status word badge `{connection.status}` (`:90-92`), the label or "No label", the host, "Key works" text, and Test and Remove icon buttons.
- **`apps/mobile/src/components/connections/use-connections.ts` (160 lines)** returns the list state, `runTest`, `testResults: Record<string, boolean>` (`:31`, `:144-160`) and the remove actions.
- **The API:** `ConnectionsApi.replaceConnectionKey(id, key)` already exists (`apps/mobile/src/lib/connections-api.ts:49`, `:102`).
- **Connection status:** it is `'active' | 'revoked'` on the server. No failure is stored; only this screen's last test knows one.
- **The kit:**
  - `ActionSheet` and `ActionSheetItem` (`apps/mobile/src/components/ui/action-sheet.tsx:50`, `:149`);
  - `ConfirmDialog` (`apps/mobile/src/components/ui/confirm-dialog.tsx`);
  - `IconButton` (40 px);
  - `TextField` (`apps/mobile/src/components/ui/text-field.tsx`);
  - the toast (`apps/mobile/src/components/ui/toast.tsx`).

### Steps
1. **Header (`connections-header.tsx`):**
   - Back on the left; on the right, an Add `IconButton` (`Plus`, label "Add key") when ready;
   - under them, the large title "Connections" (28 px, 600);
   - no subtitle.
2. **The row (rewrite `connection-card.tsx` as `ConnectionRow`):** a pressable row (min height 64, `px-4`, divided by a hairline) with:
   - an 8 px dot: green (`bg-online`, label "Working") when `status === 'active'` and the last test here did not fail; red (`bg-danger`, "Not working") otherwise;
   - the provider name (16 px, 600);
   - the muted line (14 px), parts joined with " · ":
     1. the red reason when not working: the failed test's message, or "Key revoked";
     2. the label, if any;
     3. the host for a custom base URL;
     4. the short date;
   - a ⋯ glyph (`MoreHorizontal`, muted).
   
   Remove the status word, the "No label" text and the two icon buttons. The row press opens the sheet.
3. **New `apps/mobile/src/components/connections/connection-sheet.tsx`:** an `ActionSheet` whose header is the dot and the name.
   - **"Test key":** runs the test. A pass shows a green `Check` at the item's right, and a fail closes the sheet so the row shows the reason.
   - **"Replace key":** switches the sheet to a secure `TextField` ("New API key") with Save and Cancel. Save calls `replaceConnectionKey(id, key.trim())`, shows the toast "Key replaced", and forgets a failed test. An error shows in the sheet's error slot.
   - **"Delete":** red; opens a `ConfirmDialog` ("Delete <Provider> key?", confirm "Delete"), then removes the connection with the existing remove action.
4. **`use-connections.ts`:** keep the last test's failure message per connection (next to `testResults`), and add a `replaceKey(id, key)` action. Keep the file under 400 lines.
5. **`connections.tsx`:** one rounded list (`overflow-hidden rounded-2xl border border-divider bg-surface`, `mx-4`) of `ConnectionRow`s, and the sheet. The empty state reads "No keys yet", with the action "Add key".

### Not in scope
- web;
- the server;
- `add-key-sheet.tsx` (the Add flow stays).

### Tests
None new (UI). Keep `use-key-check.test.ts` passing.

### Allowed files
- `apps/mobile/src/app/settings/connections.tsx`
- `apps/mobile/src/components/connections/connections-header.tsx`
- `apps/mobile/src/components/connections/connection-card.tsx`
- `apps/mobile/src/components/connections/connection-sheet.tsx` (new)
- `apps/mobile/src/components/connections/use-connections.ts`
- `work/T-1516-mobile-connections.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The screen:** the header keys and large title, then one list of rows (dot, name, muted line, ⋯) with no status words.
- **A row opens the sheet:**
  - Test key shows a green check on a pass;
  - Replace key saves a new key;
  - Delete asks, then removes.

---

## Report (written by the worker when done)

### What I did

- **Header (`connections-header.tsx`):** Back and the 40 px Add `IconButton` ("Add key") on one line, the 28 px "Connections" title under them. No subtitle.
- **The row (`connection-card.tsx`, rewritten as `ConnectionRow`):** a 64 px pressable row (`pl-4 pr-3`, hairline between rows) with an 8 px dot (green `bg-online` "Working" when `status === 'active'` and no failed test here, red `bg-danger` "Not working" otherwise), the provider name (16/600), a muted line (14 px) and a `MoreHorizontal` glyph. The muted line joins, with " · ": the red reason ("Key revoked" or the failed test's fixed sentence), the label, the host for a custom base URL, and the short date. The whole row opens the sheet. Removed the status word, "No label" and the two icon buttons.
- **The sheet (`connection-sheet.tsx`, new):** an `ActionSheet` whose header is the dot and the name. **Test key** runs the test and shows a green `Check` at the item's right after a pass; a failure closes the sheet so the row shows the reason. **Replace key** switches the sheet to a secure `TextField` ("New API key") with Save and Cancel; Save calls `replaceConnectionKey(id, key.trim())`, the screen toasts "Key replaced", and the row's last test is forgotten. **Delete** (red) opens the `ConfirmDialog`.
- **`use-connections.ts`:** keeps the last test's failure per connection in `testErrors` (next to `testResults`), and adds `replacing`, `replaceError`, `replaceKey(id, key)` and `clearReplaceError()`. New options `onTestFailed` and `onReplaced` let the screen close its sheet on a failed test and toast/close on a replaced key.
- **`connections.tsx`:** one rounded list (`mx-4 overflow-hidden rounded-2xl border border-divider bg-surface`) of `ConnectionRow`s, the sheet, a `ConfirmDialog` ("Delete &lt;Provider&gt; key?", confirm "Delete", opened only after the sheet has fully closed via the sheet's `onDismissed`), and the toast. Empty state is now "No keys yet" with the action "Add key".

No server or secret-touching change: the new key field is `secureTextEntry` and the key travels only in the existing replace call, never logged or rendered elsewhere.

### Checks run

- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/connections/use-key-check.test.ts`: 1 file passed, 2 tests passed.
- `pnpm gate` (repo root): **GATE PASS**

  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (2.1s)
  PASS  format  (0.8s)
  PASS  lint  (1.0s)
  PASS  typecheck  (4.0s)
  PASS  effect  (1.0s)
  PASS  tests @zilar/mobile  (3.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into the Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

  One earlier `pnpm gate` run failed typecheck: `connections.tsx(184,44): error TS2554: Expected 1 arguments, but got 2.` The `useAction` trigger takes a single input; I fixed it by wrapping `replaceKey(id, key)` in the hook. The run above is the final, passing one.

### Files changed

- `apps/mobile/src/app/settings/connections.tsx`
- `apps/mobile/src/components/connections/connections-header.tsx`
- `apps/mobile/src/components/connections/connection-card.tsx`
- `apps/mobile/src/components/connections/connection-sheet.tsx` (new)
- `apps/mobile/src/components/connections/use-connections.ts`
- `work/T-1516-mobile-connections.md` (status + this report)

### Notes for the lead

- The mock backend's `POST /api/connections/:id/test` always answers `{ ok: true }`, so the red-dot and "fail closes the sheet" paths can only be seen against the real API. This is UI; I did not run a live device smoke.
- The spec's "Facts" line numbers were slightly stale (the file already had `testErrors`, `confirmingId`, `removeError`, `busy`); I worked from the current code, not the quoted line numbers.
- The replace-key keyboard: `ActionSheet`/TrueSheet (`detents={['auto']}`) sets no keyboard inset, so on device the keyboard may cover the Save button. `action-sheet.tsx` is outside my Allowed files, so I did not change it — flagging in case it shows in the phone smoke.
- The delete dialog's body sentence ("This removes the provider key from your account.") is not in the spec; I chose a short fixed sentence. Happy to change the copy.

### Round 1 (fix round)

Findings source: `PREREVIEW.md` (worker commit `d02454c`).

**Fixed**
- **Finding 1 (must-fix): a stale replace error leaked into other sheets.**
  `replaceError` lives in the hook and was shown whenever a sheet was open, but
  nothing cleared it on open or close. `connections.tsx` now calls
  `clearReplaceError()` in `openSheet` (before the sheet remounts) and in the
  sheet's `onClose` (a user dismissal), so a failure on key A can no longer show
  in key B's sheet.
- **Finding 2 (should-fix): a late test response clobbered a replaced key's
  state.** `runTest` and `runReplaceKey` are separate `useAction` locks and can
  run concurrently, so a slow test that started before a Replace could write its
  result onto the new, untested key. `use-connections.ts` now keeps a
  `replaceGeneration` ref: `runTest` captures it when it starts and, in both the
  success and the failure handler, drops the result (and does not call
  `onTestFailed`) when a replace bumped it; `replaceKey` bumps it before the
  replace starts.

**Nit left untouched**
- **Finding 3 (nit): the row padding (`connection-card.tsx:55`, `pl-4 pr-3` vs
  the spec's `px-4`).** Not a line this round changes, so per the fix-round rule
  I left it as is.

**Disagreements:** none — both findings were correct and are fixed.

**Follow-ups (unchanged; each fixes a file outside the Allowed files):** F1 the
keyboard overlap in `action-sheet.tsx`; F2 the raw `error.message` in
`errors.ts:30`. Both left untouched.

**Tests added: none.** Both findings are in the UI layer (the screen's wiring and
its view hook); this task's Spec says "Tests: None new (UI)" and AGENTS.md gives
UI code no tests, and the Allowed files list no test file, so a new test file
would trip the gate's scope check. The kept
`src/components/connections/use-key-check.test.ts` still passes.

**Checks run**
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/components/connections/use-key-check.test.ts` → `Test Files 1 passed (1)`, `Tests 2 passed (2)`.
- `pnpm gate` (repo root) → **GATE PASS**:

  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (2.2s)
  PASS  format  (1.9s)
  PASS  lint  (1.4s)
  PASS  typecheck  (4.9s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/mobile  (1.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

`status` stays `review`.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean after 1 automatic round, with 1 nit and 2 follow-ups, for head `b75d3b298`.
- **Phone smoke (mock build, emulator):** `/settings/connections` passed.
  - Back and Add keys over the large title "Connections", then one rounded list: OpenAI "Work key · Sep 20", Anthropic "Personal key · Sep 21", and OpenAI-compatible "Groq · api.groq.com · Sep 22", each with a green dot and ⋯.
  - No status words.
- **The sheet, read in code (`connection-sheet.tsx`):** Test key (a green `Check` after a pass), Replace key (a secure field with Save and Cancel), and Delete (red, confirmed). The smoke opens routes only, so the sheet was not seen on screen.

