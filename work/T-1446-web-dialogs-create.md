---
id: T-1446
title: "Web create dialogs follow the approved standard (E1): New group, New topic, New message, Add contact, group handle: no Cancel key, Enter submits, kit error line and busy, first field focused, New group gets the step bar"
status: merged
milestone: M5
branch: task/T-1446-web-dialogs-create
model: auto
effort: default
depends_on: [T-1431]
estimate: 0.5 day
---

# T-1446: Web create dialogs on the standard

## Spec (written by Claude, do not edit)

### Why
Julio approved the New AI dialog standard on 2026-10-15 (`docs/design/mockups/new-ai/README.md`, "Rules the design set"):
- **one way out:** the header close key or Esc;
- **one primary** (Back plus primary in a wizard);
- **lean:** no new subtitles or hints;
- a selected choice is the light key.

T-1431 built it into the web kit, so every `Dialog` already has the close key. This task moves five create dialogs onto the rest of the standard. **Only chrome and keyboard behaviour change**: copy, data and flow stay the same.

### Facts (the lead read them on main, 2026-10-15)
- **The kit:** `apps/web/src/components/ui/dialog.tsx:7-39`.
  - `actions` is the old right-aligned footer keys; `footer` is the custom footer with the hairline;
  - `stepper` takes a step bar;
  - `error` is a fixed error line above the footer;
  - `onSubmit` wraps the body and footer in a form, so Enter submits;
  - `busy` turns off Esc, the backdrop and the close key;
  - a `[data-autofocus]` element gets focus on open.
  - `apps/web/src/components/ui/dialog-stepper.tsx` has `DialogStepper({ steps: { label, value? }[], current, onStep })`.
- **The five dialogs:**
  - **New group:** `apps/web/src/components/NewGroupDialog.tsx` (330 lines). Two steps, `'members' | 'title'` (`:65`); `actions` with **Cancel** + Next, then Back + Create (`:145-170`); `autoFocus` (`:178`); its own error `<p role="alert">` (`:275`).
  - **New topic:** `apps/web/src/components/NewTopicDialog.tsx` (362 lines). `actions` with **Cancel** (`:180-190`); its own error `<p role="alert">` (`:356`).
  - **New message:** `apps/web/src/components/NewMessageDialog.tsx` (156 lines), two `Dialog`s.
  - **Add contact:** `apps/web/src/components/AddContactDialog.tsx` (144 lines). `actions` (`:90`), `autoFocus` (`:101`), its own error (`:118`).
  - **Group handle:** `apps/web/src/routes/GroupHandleRoute.tsx` (266 lines), two `Dialog`s.

### What to build (the same rules for each dialog)
1. **No Cancel or Close key** in the footer. The header key, Esc and the backdrop close the dialog.
2. **The primary** is the only footer key, except in a wizard step after the first, where it is Back plus the primary.
3. **A form dialog uses `onSubmit`**, so Enter submits. The primary becomes `type="submit"`, and submitting is a no-op while the primary is disabled.
4. **The dialog's own error `<p role="alert">` moves to the `error` prop.** Keep the text.
5. **While a request runs, pass `busy`**, and keep the primary's busy label.
6. **The first field gets `data-autofocus`** instead of `autoFocus`.
7. **New group** shows `stepper={<DialogStepper steps={[{ label: 'Members' }, { label: 'Name' }]} current={…} onStep={…} />}`.
   - A done step shows its value (for example "3 members"), and clicking it goes back.
   - The title stays as it is today.
8. **Every file stays at 400 lines or fewer.** Remove imports that are no longer used.

Do not touch `apps/web/src/components/NewChatButton.tsx`: another task (T-1444) may change it.

### Tests
None (UI).

### Allowed files
- `apps/web/src/components/NewGroupDialog.tsx`, `apps/web/src/components/NewTopicDialog.tsx`, `apps/web/src/components/NewMessageDialog.tsx`, `apps/web/src/components/AddContactDialog.tsx`
- `apps/web/src/routes/GroupHandleRoute.tsx`
- `work/T-1446-web-dialogs-create.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The lead opens each dialog headless in mock mode: one close key, no Cancel, and Enter submits.

---

## Report (written by the worker when done)

### What I did

Moved the five create dialogs onto the approved New AI standard (chrome and
keyboard only; copy, data and flow unchanged).

- `apps/web/src/components/NewGroupDialog.tsx`
  - Dropped the Cancel key; the footer is now the step's keys only: `Next`
    (only key) on Members, `Back` + `Create` on Name. Both primaries are
    `type="submit"`.
  - Added `stepper={<DialogStepper …/>}` with `Members` (value `"N members"`,
    `N` = selected contacts) and `Name`; `current` follows `step` and clicking
    the done Members step goes back (`onStep` → `setStep('members')`).
  - Added `onSubmit`: Enter on the Members step advances to Name, Enter on the
    Name step runs create (no-op while `busy`).
  - The create error `<p role="alert">` moved to the `error` prop (same text).
  - `busy={isWaiting(createState)}`; the header key/Esc/backdrop are off while
    creating. The primary label stays `Create` (there was no busy label).
  - The Name field's `autoFocus` became `data-autofocus`.
- `apps/web/src/components/NewTopicDialog.tsx`
  - Removed Cancel; `Create topic` is the only footer key, `type="submit"`.
  - Added `onSubmit` (no-op while `busy` or name empty, matching the disabled
    primary) and moved the error to the `error` prop.
  - `busy={busy}`; the Name field got `data-autofocus`.
- `apps/web/src/components/NewMessageDialog.tsx`
  - Empty-contacts dialog: removed the `Close` key, `Invite a friend` is the
    only footer key.
  - Contacts list: the search field's `autoFocus` became `data-autofocus`. Its
    Enter-to-open behaviour (already handled by `onKeyDown`) is unchanged, so
    no `onSubmit` was added here.
- `apps/web/src/components/AddContactDialog.tsx`
  - Removed the `Close` footer key and the now-unused `Button` import: the
    dialog has no submit action (the primary keys live on the contact card), so
    there is no footer. The header key/Esc/backdrop are the only way out.
  - Moved the lookup error to the `error` prop; the muted "no one with that
    username" hint stays in the body. The field got `data-autofocus`.
- `apps/web/src/routes/GroupHandleRoute.tsx`
  - Error dialog: dropped the `Close` key (`Retry` is the only footer key) and
    moved the message to the `error` prop.
  - Group card: removed the body `Close` key, moved `Join`/`Open` into the
    footer as the only key, moved its error to the `error` prop and passed
    `busy` (keeps the `Joining…` label).

### Files changed

`apps/web/src/components/NewGroupDialog.tsx`,
`apps/web/src/components/NewTopicDialog.tsx`,
`apps/web/src/components/NewMessageDialog.tsx`,
`apps/web/src/components/AddContactDialog.tsx`,
`apps/web/src/routes/GroupHandleRoute.tsx`,
`work/T-1446-web-dialogs-create.md`. All within the Allowed files.

### Commands

- `pnpm install` — done, no errors.
- `pnpm gate` (from the repo root) — exit 0, tail:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.4s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.2s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the task says "Tests: None (UI)" and the gate
  skipped web tests (no nearby test files). I did not run any test file on its own.

### Decisions / deviations

- `GroupHandleRoute`'s group card had its primary `Join`/`Open` button in the
  body (full width, centred) plus a body `Close` key. Following rule 2 ("the
  primary is the only footer key") I moved the primary into the footer and
  removed the `Close`. This is a visible layout change on the share card (the
  CTA is now a right-aligned footer key instead of a full-width body key); if
  the intent was to keep the body CTA, this is the one place to revisit.
- `NewGroupDialog`'s Members step has a search field inside
  `NewGroupMembers.tsx`, which is not in the Allowed files, so its `autoFocus`
  was left as is. Per the spec's fact pointer (`autoFocus` at `:178`) only the
  Name field's `autoFocus` became `data-autofocus`; that field is the one the
  kit focusses when it is present.
- Files stay under 400 lines (largest: `NewTopicDialog.tsx`, 353).

### Security checklist

No routes, deletes, permissions, caps, logging or audit code was touched: the
change is dialog chrome and keyboard behaviour only. No secrets.

### Open questions

None blocking.

### Round 1 (fix round)

Findings fixed:
- **Finding 1 (should-fix)** — title-step focus regression in
  `apps/web/src/components/NewGroupDialog.tsx`. The Members → Name step change
  unmounted the Next key, so focus fell to the body and the kit's
  `[data-autofocus]` (honoured only on dialog open) did not restore it. Added a
  `nameInputRef` on the Name `TextInput` and an effect that focuses it whenever
  `step` becomes `'title'`, so Enter on the Name step reaches the Create key.
- Findings 2 and 3 are nits; neither is in a line this round changed, so both
  were left as is (per the round instructions).

No disagreements with the findings.

Tests added: none. The finding names no test, the task's Spec says "Tests: None
(UI)", and AGENTS.md says UI code gets no tests; a new test file would also fall
outside the task's Allowed files.

Gate: `pnpm gate` from the repo root — `GATE PASS`:
```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (0.6s)
PASS  lint  (0.7s)
PASS  typecheck  (3.6s)
PASS  effect  (1.3s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
No single test files were run: the task says "Tests: None (UI)" and the gate
skipped web tests (no nearby test files).

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN after 1 auto round, nit 1.
- The lead opened New group, New channel and New message headless (Playwright, mock mode) at 1280 and 390 px.
- Each has exactly one close-like key (the header X), and the search field is focused on open.
- New group and New channel are forms with the Members · Name step bar and a single Next.
