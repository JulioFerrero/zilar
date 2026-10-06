---
id: T-0279
title: "Web kit migration 12: hand-rolled accent buttons and links on the sign-in and onboarding pages become the kit Button"
status: merged
milestone: M5
branch: task/T-0279-web-kit-accent-buttons-5
model: auto
effort: low
depends_on: []
estimate: 0.4 day
---

# T-0279: accent buttons on the kit Button, batch 5 (sign-in and onboarding)

## Spec (written by Claude, do not edit)

### Why
This is batch 5 of removing the flat `bg-accent px-` pill outside the kit (`docs/audit/ui-kit-audit.md` line 437). T-0275 and T-0276 did batches 1 and 2. Copy their approach; their Reports are in `work/T-0275-web-kit-accent-buttons-1.md` and `work/T-0276-web-kit-accent-buttons-2.md`.

The kit primary is `Button` (`apps/web/src/components/ui/button.tsx`):
- the default variant is `key-primary`;
- sizes are `sm`, `default` and `lg` (`h-9`);
- `asChild` renders the child element (for example a router `Link`) with the button styles;
- it renders `data-slot="button"`.

### Verified facts (do not re-derive)
All of these carry `rounded-… bg-accent px-… text-accent-foreground hover:bg-accent/90`.
- `apps/web/src/components/auth/AuthFlow.tsx`: `<button>` at line 157 (`px-4 py-2.5 text-[15px]`) and line 190 (`px-5 py-2 text-[15px]`).
- `apps/web/src/routes/JoinPage.tsx`:
  - `<Link>` (from `react-router`, line 2) at lines 96, 213 and 246;
  - `<button>` at line 222.
- `apps/web/src/routes/HandlePage.tsx`: `<button>` at line 146.
- `apps/web/src/routes/LoginPage.tsx`: `<Link>` at line 43. It has no test file.
- `apps/web/src/routes/SetupPage.tsx`: `<button>` at lines 76, 181 and 240.
- `apps/web/src/routes/NamePage.tsx`: `<button>` at line 68.
- These are the big call-to-action buttons on cards (`py-2` / `py-2.5`, `text-[15px]`).
- Tests: `AuthFlow.test.tsx`, `JoinPage.test.tsx`, `HandlePage.test.tsx`, `SetupPage.test.tsx` and `NamePage.test.tsx` sit next to their files.

### What to build
1. Every element listed above becomes the kit `Button` with `size="lg"`:
   - a `<Link>` becomes `<Button asChild size="lg"><Link …>text</Link></Button>`;
   - keep `type`, `to`, `onClick`, `disabled`, aria attributes, icons and text;
   - keep layout-only classes (`w-full`, `mt-…`, `self-…`) through `className`; drop the colour, padding, radius, font and gap classes.
   - If a full-width call-to-action now looks too short next to the inputs on the same card (inputs are `py-2.5`), you may add `className="h-10"` on those buttons only, and say so in the Report.
2. Tests:
   - existing tests keep passing, changed only where they relied on the old markup;
   - add one `data-slot="button"` assertion in each existing test file listed above;
   - do not create a LoginPage test.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx`, `work/T-0276-web-kit-accent-buttons-2.md` (Report), and the six files with their tests.

### Allowed files
`apps/web/src/components/auth/AuthFlow.tsx`, `apps/web/src/components/auth/AuthFlow.test.tsx`, `apps/web/src/routes/JoinPage.tsx`, `apps/web/src/routes/JoinPage.test.tsx`, `apps/web/src/routes/HandlePage.tsx`, `apps/web/src/routes/HandlePage.test.tsx`, `apps/web/src/routes/LoginPage.tsx`, `apps/web/src/routes/SetupPage.tsx`, `apps/web/src/routes/SetupPage.test.tsx`, `apps/web/src/routes/NamePage.tsx`, `apps/web/src/routes/NamePage.test.tsx`, `work/T-0279-web-kit-accent-buttons-5.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot AuthFlow JoinPage HandlePage SetupPage NamePage
pnpm gate
```

### Acceptance
- None of the six source files contains `bg-accent px-`. Texts, links and behaviour are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. `pnpm-lock.yaml` must not change.

### Out of scope
Every other file with `bg-accent px-`, and the gate check (a later task).

---

## Report (written by the worker when done)

### What I did
Replaced every listed hand-rolled `bg-accent px-…` call-to-action with the kit
`Button` (`import { Button } from '@/components/ui/button'`), all `size="lg"`
(the listed elements are the big `py-2` / `py-2.5`, `text-[15px]` card CTAs).
`type`, `to`, `state`, `onClick`, `disabled` and the text are kept; colour,
padding, radius, font and gap classes are gone; only layout classes
(`mt-1`, `mt-4`, `mt-5`, `w-full`, `flex-1`) stay via `className`.

- `apps/web/src/components/auth/AuthFlow.tsx`: the email-step "Continue"
  (`<button type="submit">`) and the code-step "Continue"
  (`<button type="button">`) are `<Button size="lg">`. The "Resend code"
  and "Use a different email" text buttons were not in scope and are untouched.
- `apps/web/src/routes/JoinPage.tsx`: the three `Link`s ("Sign in" at the guest
  card, "Choose a name" at the name gate, "Back to chats" in `JoinCard`) are now
  `<Button asChild size="lg">` wrapping the same `Link` (with the same `to` /
  `state`); the "Join the group / channel" `<button>` is `<Button size="lg">`.
- `apps/web/src/routes/HandlePage.tsx`: the "Continue" submit is
  `<Button size="lg" className="mt-4 w-full">`; "Skip for now" (not accent) is
  untouched.
- `apps/web/src/routes/LoginPage.tsx`: the "Finish setting up this server"
  `Link` is `<Button asChild size="lg">`.
- `apps/web/src/routes/SetupPage.tsx`: "Retry", "Next" and "Send my code"
  are `<Button size="lg">` ("Send my code" keeps `disabled={busy}` and
  `className="flex-1"`); the outlined "Back" button (not accent) is untouched.
- `apps/web/src/routes/NamePage.tsx`: the "Continue" submit is
  `<Button size="lg" className="mt-4 w-full">`.
- Muted / outlined buttons in these files and every other file with
  `bg-accent px-` were left alone (out of scope).

### Note on `h-10`
The spec's premise is that the inputs on these cards are `py-2.5`. I checked the
six files: the inputs are `px-3 py-2 text-[15px]` (`h-9`), and the `lg` Button is
also `h-9`, so the full-width CTAs line up with the inputs without a height
override. No `className="h-10"` was added anywhere.

### Tests added
One `data-slot="button"` assertion per existing test file listed:
- `AuthFlow.test.tsx` (email-step "Continue"),
- `JoinPage.test.tsx` ("Join the group"),
- `HandlePage.test.tsx` ("Continue"),
- `SetupPage.test.tsx` ("Next"),
- `NamePage.test.tsx` ("Continue").
No LoginPage test was created. Existing queries by role/text needed no changes
(links keep the `link` role through `asChild`, buttons keep the `button` role).

### Commands and results
- `pnpm install` — Done in 12.8s; `pnpm-lock.yaml` was **not** modified (checked
  with `git status`), so no revert was needed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot AuthFlow JoinPage HandlePage SetupPage NamePage`
  — `Test Files 5 passed (5)`, `Tests 31 passed (31)` (4.19s). One pre-existing
  stderr line in `SetupPage.test.tsx` ("No routes matched location \"/\"") does
  not fail the run.
- `rg -n "bg-accent px-" <six source files>` — no matches.
- `pnpm gate` — first run FAILed only on `format` (Prettier flagged
  `AuthFlow.tsx` and `JoinPage.test.tsx`, which I had left over-wrapped);
  I fixed those two files with `pnpm exec prettier --write …` (formatting only),
  then re-ran `pnpm gate`:
  - `gate: 12 changed file(s) against main`
  - `PASS  install (frozen)  (1.0s)`
  - `PASS  format  (21.1s)`
  - `PASS  lint  (1.4s)`
  - `PASS  typecheck  (15.5s)`
  - `PASS  tests @zilar/web  (27.2s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Files changed
- `apps/web/src/components/auth/AuthFlow.tsx`
- `apps/web/src/components/auth/AuthFlow.test.tsx`
- `apps/web/src/routes/JoinPage.tsx`
- `apps/web/src/routes/JoinPage.test.tsx`
- `apps/web/src/routes/HandlePage.tsx`
- `apps/web/src/routes/HandlePage.test.tsx`
- `apps/web/src/routes/LoginPage.tsx`
- `apps/web/src/routes/SetupPage.tsx`
- `apps/web/src/routes/SetupPage.test.tsx`
- `apps/web/src/routes/NamePage.tsx`
- `apps/web/src/routes/NamePage.test.tsx`
- `work/T-0279-web-kit-accent-buttons-5.md`

All 12 are inside the Allowed files; no lockfile change.

### Acceptance
- None of the six source files contains `bg-accent px-`; texts, links and
  behaviour unchanged.
- `pnpm gate` ends with `GATE PASS` and lists no file outside the Allowed files.

### Deviations / open questions
- None beyond the `h-10` note above (not needed, because inputs are `h-9`).
- Security checklist: no secrets, routes, deletes or audit paths touched.

## Review (written by Claude)

Approved. The pre-review was clean with 0 nits, and there were no fix rounds.
- All four router `Link`s use `<Button asChild size="lg">`, so they stay links with the same `to`.
- The buttons are `size="lg"`.
- `h-10` was not needed: the inputs are `h-9`.
- No `bg-accent px-` is left in the six files.
