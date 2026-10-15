---
id: T-1510
title: "Web My AIs with health (approved AI health canvas): one list, a health dot on each AI's picture (working, failing with its reason, paused by the daily limit), today's spend with a limit bar, a ⋮ menu, 'New AI' in the header"
status: merged
milestone: M5
branch: task/T-1510-web-ai-health
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1510: Web My AIs with health

## Spec (written by Claude, do not edit)

### Why
Julio approved the AI health design on 2026-10-15. The boards are in `docs/design/mockups/ai-health/`; read `README.md` and `Main.dc.html`.

**Each row holds:**
- the AI's picture with a health dot on its lower right:
  - green: working;
  - red: failing;
  - amber: paused by its daily limit;
- the name and the "AI" badge;
- one muted line:
  - normally `model · provider`;
  - when failing, the reason in red plus a fix link;
  - when paused, `Daily limit reached` in amber;
- today's spend in mono (`$0.00 / $2` with a thin bar when there is a daily limit; the bar is amber when full);
- a ⋮ key.

The health dot is the status: no status words. Julio approved the spend column on this page.

T-1504 (merged) put `lastFailure: { kind, at } | null` on every AI in the list.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/routes/AisPage.tsx` (290 lines):**
  - `SettingsShell` with the subtitle "Your AIs, their model and their spending limits." (`:69-73`);
  - the empty state (`:87-95`);
  - the list section with its own "Your AIs" heading and a "Create AI" button (`:97-131`);
  - `AiRow` (`:142-274`): a 44 px `EntityAvatar` (`ai`), the name, `AiBadge`, a status word badge when `status !== 'active'` (`:186-190`), `template · model · provider`, "Today $x", `formatLimits(limits)`, and three icon buttons (open chat, edit, delete) with an inline confirm;
  - `providerNamesOf` (`:276-290`).
- **`PublicAi`** (`packages/api-contract/src/ais.ts`) has:
  - `status` (`active | disabled | stopped`);
  - `limits.perDayUsd` (null means no limit);
  - `usage` (`{ todayUsd, windowUsd }`, or null/absent when unavailable);
  - `lastFailure` (`{ kind, at }` or null/absent).
- **The failure kinds** are `key_rejected`, `rate_limited`, `model_not_found`, `context_too_long`, `timeout`, `provider_error`, `budget` and `other` (`apps/server/src/agents/failure-class.ts:10-18`).
- **The mock** (`packages/mock-backend/src/domains/ais/seed.ts`): Dev-1 is healthy ($0.42, no limit), QA-1 is failing (`key_rejected`, limit $2, usage null), and Marketing AI is at its limit ($5 of $5).
- **The kit:**
  - `SettingsShell` has an optional `subtitle` and an `action` slot (T-1503);
  - the ⋮ menu pattern is `apps/web/src/components/connections/ConnectionRow.tsx` (T-1503);
  - `ConfirmDialog` is `apps/web/src/components/ConfirmDialog.tsx`;
  - `IconButton` is 36 px.

### What to build
1. **The page (`AisPage.tsx`):**
   - `SettingsShell` with the title "My AIs", no subtitle, and as `action` a primary `Button` with `Plus` and the text "New AI", which opens `NewAiDialog`;
   - the empty state reads "No AIs yet", with the action "New AI";
   - the list is one card (`overflow-hidden rounded-xl border border-border bg-surface`, rows divided by `border-b border-divider`) with no heading of its own.
2. **New `apps/web/src/components/ais/AiHealthRow.tsx`.** Move `AiRow` here and redraw it after `Main.dc.html`. Keep `AisPage.tsx` and this file under 400 lines.
   - **Layout:** `flex items-center gap-3.5 py-3 pr-2.5 pl-3.5`.
   - **The picture:** a 40 px `EntityAvatar` (`ai`), with a 12 px health dot at its lower right (ring 2 px in the surface colour, `role="img"`). Its `aria-label` and colour are, first match wins:
     1. `status !== 'active'`: "Stopped", `bg-subtle-foreground`;
     2. `lastFailure` set: "Failing", `bg-danger`;
     3. paused (`limits.perDayUsd !== null && usage != null && usage.todayUsd >= limits.perDayUsd`): "Paused by its limit", amber (`bg-[#f59e0b]`, or the kit's warning token if one exists);
     4. otherwise "Working", `bg-online`.
   - **The name row:** the name (`text-[14px] font-semibold`) and `AiBadge`. No status word badge.
   - **The muted line** (`text-[13px] text-muted-foreground`), in the same order:
     1. **stopped:** "Stopped · <model>";
     2. **failing:** the reason in `text-danger`, then " · ", then a fix link:

        | Kind | Reason | Link |
        | --- | --- | --- |
        | `key_rejected` | "Key rejected" | "Replace key" → `/settings/connections` |
        | `model_not_found` | "Model not found" | "Change model" → the AI's edit panel (today's `onEdit`) |
        | `rate_limited` | "Rate limited" | none (show the model) |
        | `budget` | "Provider budget reached" | none |
        | `context_too_long` | "Too much context" | none |
        | `timeout` | "Timed out" | none |
        | anything else | "Last reply failed" | none |
     3. **paused:** "Daily limit reached" in amber, " · ", then the model;
     4. **otherwise:** `<model> · <provider name>` (the provider name as today; the model alone if unknown).
   - **The spend column:** 96 px wide, right-aligned, mono 12 px.
     - `usage` null or absent: a muted "—";
     - no daily limit: `$0.42`;
     - with a limit: `$0.00 / $2` (the limit muted), and under it a 72 × 4 px bar (`rounded-[2px] bg-well`). Its fill is `min(1, today / limit)`, `bg-foreground`, or amber when full.
     - Reuse `formatUsd`.
   - **The ⋮ `IconButton`** (`MoreVertical`, `aria-label="<name> actions"`) opens a `Menu`:
     - "Open chat" (`MessageSquare`);
     - "Edit" (`Pencil`);
     - "Delete" (`Trash2`, `destructive`), which opens a `ConfirmDialog` ("Delete <name>?", body "This removes the AI and its chat. Your provider connection stays.", confirm "Delete"). A delete failure shows in the dialog or under the row as today.
   - Drop the template label and the `formatLimits` line. The limit lives in the spend column.

### Not in scope
- the server;
- the mobile app;
- the AI panel.

### Tests
None (UI, CLAUDE.md Hard rules).

### Allowed files
- `apps/web/src/routes/AisPage.tsx`
- `apps/web/src/components/ais/AiHealthRow.tsx` (new)
- `work/T-1510-web-ai-health.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- `/settings/ais?mock=1` at 1280 and 390 px:
  - **Dev-1:** green dot, `gpt-4o · OpenAI`, `$0.42`;
  - **QA-1:** red dot, "Key rejected · Replace key", `—`;
  - **Marketing AI:** amber dot, "Daily limit reached · claude-sonnet-5", `$5.00 / $5` with a full amber bar.
- The ⋮ menus hold Open chat, Edit and Delete.
- No status words, no horizontal scroll.

---

## Report (written by the worker when done)

### What I did

Redrew the web My AIs page after the approved boards.

- **`apps/web/src/routes/AisPage.tsx`** (now 133 lines):
  - `SettingsShell` title "My AIs", no subtitle; the `action` slot is the primary
    `Button` "New AI" (`Plus`), which opens `NewAiDialog`.
  - Empty state: title "No AIs yet", action "New AI".
  - The list is one card (`overflow-hidden rounded-xl border border-border
    bg-surface`); the heading and the "Create AI" row are gone.
- **`apps/web/src/components/ais/AiHealthRow.tsx`** (new, 261 lines): `AiRow`
  moved here and redrawn:
  - 40 px `EntityAvatar` (`ai`) with a 12 px health dot (ring 2 px `ring-surface`,
    `role="img"`); first match wins: stopped (`bg-subtle-foreground`), failing
    (`bg-danger`), paused by its limit (`bg-[#f59e0b]`; the kit has no warning
    token), else working (`bg-online`).
  - Name + `AiBadge`; the status-word badge is gone.
  - One muted line: stopped → "Stopped · model"; failing → the reason in red plus
    a fix ("Replace key" → `/settings/connections`, "Change model" → `onEdit`,
    else model only); paused → "Daily limit reached" in amber plus the model;
    else "model · provider".
  - Spend column (96 px, right-aligned, mono 12 px): "—" when `usage` is
    null/absent, `formatUsd(today)` with no limit, `formatUsd(today) / formatLimit(limit)`
    (limit muted) plus a 72 × 4 px `bg-well` bar when there is a limit. The fill
    is `min(1, today / limit)` `bg-foreground`, amber when full.
  - ⋮ `IconButton` (`MoreVertical`, `aria-label="<name> actions"`) opens a `Menu`
    (Open chat, Edit, Delete). Delete opens a `ConfirmDialog` ("Delete <name>?");
    a failure closes the dialog and shows under the row (`FieldError`), as before.
  - Dropped the template label and the `formatLimits` line, and the `formatUsd`
    helper moved here from `AisPage.tsx` (`formatLimit` for the limit so it reads
    `$5`, matching the board).

### Checks run

- `pnpm install` — Done in 17.2s, 1137 packages added. Pre-existing
  `@types/react-dom` peer warning (unrelated).
- `pnpm gate` — **GATE PASS**. Summary lines:
  - `gate: 6 changed file(s) against main`
  - `PASS  install (frozen)  (1.8s)`
  - `PASS  format  (0.7s)`
  - `PASS  lint  (2.1s)`
  - `PASS  typecheck  (3.6s)`
  - `PASS  effect  (0.6s)`
  - `SKIP  tests @zilar/web (no nearby test files)`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`
- I ran no single package tests: this is UI (CLAUDE.md Hard rules) and the gate
  skips `@zilar/web` for the same reason.

### Notes for the lead

- **Scope lists 3 files I did not touch.** The gate's scope check diffs against
  `main...HEAD`, which includes this branch's setup commit `d40b493a4 "T-1510:
  approved AI health boards"` that added `docs/design/mockups/ai-health/`
  (`Main.dc.html`, `Phone.dc.html`, `README.md`). They are not in this task's
  Allowed files and I made no edits to them; I cannot make the scope list clean
  without touching files outside scope or rewriting the branch, which the rules
  forbid. Every file I changed is inside the Allowed files (same situation the
  T-1495/T-1500 workers reported). The spec itself points at those boards, so I
  left them untouched.
- The amber colour is a literal `#f59e0b` because the kit has no warning token
  (checked `apps/web/src/index.css`); the board uses the same hex.
- I did not run `pnpm gate` more than once, and ran no gate commands separately,
  per AGENTS.md.

### Round (fix round, 2026-10-15)

- **Findings fixed:** none. The only should-fix (finding 1) is disputed; see
  Disagreements. No source line changed this round.
- **Findings 2 and 3 (nits):** left as is — neither is in a line this round
  changes, and the fix-round rules say not to touch nits otherwise. Finding 2
  (`formatUsd` duplicated in `AiHealthRow.tsx` and `AiUsageSection.tsx`) is the
  same helper `AisPage.tsx` held before the move; finding 3 (no `dailyLimit <= 0`
  guard) is the comparison the Spec itself dictates.
- **Tests:** none added or adjusted. The Spec's Tests section is "None (UI)", no
  behaviour changed this round, and the finding names no test.
- **Gate (from the repo root):** **GATE PASS**.
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (0.8s)
  PASS  typecheck  (0.9s)
  PASS  effect  (0.4s)
  SKIP tests @zilar/web (no nearby test files)
  scope: 3 file(s) outside the Allowed files:
    docs/design/mockups/ai-health/Main.dc.html
    docs/design/mockups/ai-health/Phone.dc.html
    docs/design/mockups/ai-health/README.md
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The 3 out-of-scope files are the board-approval setup commit `d40b493a4`
  (`main...HEAD`), untouched here, exactly as the original Report's Notes explain.

### Disagreements

- **Finding 1 (should-fix) — the implemented behaviour is correct; no code
  change.** The finding says a failed delete leaves the `ConfirmDialog` open
  while the row's `FieldError` renders behind it, so the Report's "a failure
  closes the dialog and shows under the row" would be wrong. Its mechanism claim
  is not correct: `Effect.ensuring(finalizer)` is `Effect.onExit`, whose
  finalizer runs on **success, failure and interruption**. So the delete
  effect's `Effect.ensuring(Effect.sync(() => setConfirming(false)))`
  (`AiHealthRow.tsx:81`) does run when `deleteAi` fails: the dialog unmounts and
  the `FieldError` then shows under the row — precisely what the Report claims
  and what the Spec allows ("shows in the dialog or under the row"). I verified
  the semantics against the installed `effect@4.0.4` with a one-line probe:

  ```
  let fired = false;
  Effect.runPromiseExit(
    Effect.fail(new Error('x')).pipe(Effect.ensuring(Effect.sync(() => { fired = true; }))),
  );  // exit _tag "Failure", fired === true
  ```

  The same construct — ungated `FieldError` under the control plus
  `Effect.ensuring(setConfirming(false))` — is already used in
  `apps/web/src/components/tools/DeleteToolButton.tsx:27` (reviewed and shipped).
  The finding's suggested shape (gate the error on `!confirming`) would work only
  *because* `ensuring` runs on failure, and would hide the failure entirely if
  that finalizer were ever dropped; the always-rendered `FieldError` is the more
  robust invariant, so I left the code as it is.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean after 1 automatic round, with 1 nit and 1 follow-up, for head `a28a8809d`.
- **Headless check (mock, dark, 1280 and 390 px):**
  - **Dev-1:** green dot, `gpt-4o · OpenAI`, `$0.42`;
  - **QA-1:** red dot, "Key rejected · Replace key", `—`;
  - **Marketing AI:** amber dot, "Daily limit reached · claude-sonnet-5", `$5.00 / $5` with a full amber bar;
  - "New AI" in the header, and the ⋮ menu reads Open chat, Edit, Delete;
  - no status words, no horizontal scroll, 0 page errors.
- **Follow-up:** `formatUsd` is duplicated with `AiUsageSection.tsx`; share it in a later touch.
- **Carried:** the AI health boards and README in `docs/design/mockups/ai-health/`.
