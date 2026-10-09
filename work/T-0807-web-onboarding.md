---
id: T-0807
title: "WU5: web onboarding routes on Effect — HandlePage, InvitePage (tests first), SetupPage, JoinPage"
status: todo
milestone: M5
branch: task/T-0807-web-onboarding
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0807: WU5: web onboarding routes on Effect — HandlePage, InvitePage (tests first), SetupPage, JoinPage

## Spec (written by Claude, do not edit)

### Why
This is part of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09. It runs in **wave 1** of the batch mode Julio chose on 2026-10-09: the lead checks the whole wave once and sends every failure back. Plan row WU5 (line 375); WU4 (auth, T-0795) is merged. The plan flags "Julio: first-run setup and invite join": Julio checks them live before the next deploy.

### Verified facts (do not re-derive)
- **The files:**
  - `apps/web/src/routes/HandlePage.tsx` (193, H1 H3 W4): a `setTimeout` debounce at line 46; tested in `HandlePage.test.tsx`;
  - `apps/web/src/routes/InvitePage.tsx` (56, H1 W4): a `.then` at line 18; **no test**;
  - `apps/web/src/routes/SetupPage.tsx` (231, H1 W4): a `.then` at line 38; tested in `SetupPage.test.tsx`;
  - `apps/web/src/routes/JoinPage.tsx` (249, H1 W4): an async default prop at line 28; tested in `JoinPage.test.tsx`.
- **The web pattern** is in `docs/EFFECT_BRIEF.md` (Web UI), with the hooks in `apps/web/src/lib/effect/`. The models are `apps/web/src/routes/BlockedPage.tsx` and `apps/web/src/components/NewGroupDialog.tsx` (a debounced `useQuery`).

### What to build
1. Write `apps/web/src/routes/InvitePage.test.tsx` first, against the current code, and commit it ("T-0807: tests before").
2. Convert the four files. The HandlePage debounce becomes `Effect.sleep` inside a `useQuery` keyed on the input, with the same delay.

Follow `docs/EFFECT_BRIEF.md` (the wave rules, the building blocks and the traps).

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, `apps/web/src/lib/effect/use-action.ts`, `use-query.ts`, `apps/web/src/components/NewGroupDialog.tsx`, the four files and their tests.

### Allowed files
`apps/web/src/routes/HandlePage.tsx`, `apps/web/src/routes/InvitePage.tsx`, `apps/web/src/routes/InvitePage.test.tsx`, `apps/web/src/routes/SetupPage.tsx`, `apps/web/src/routes/JoinPage.tsx`, `work/T-0807-web-onboarding.md`.

### Checks (wave mode: your own tests and your package typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/web exec vitest run --reporter=dot src/routes/HandlePage src/routes/InvitePage src/routes/SetupPage src/routes/JoinPage
pnpm --filter @zilar/web typecheck
```
Run the tests 3 times when the code has timers or concurrency. Run `pnpm exec prettier --write` on your changed files before committing.

### Acceptance
- Each listed source file is `effect` (or carries a valid marker where the task says so) in `pnpm effect:map`.
- Exported names, signatures, texts and behaviour are unchanged, or each difference is listed in the Report.
- Existing tests pass unchanged; new tests pass; the package typecheck is clean.
- Only Allowed files change.

---

## Report (written by the worker when done)

## Review (written by Claude)
