---
id: T-0279
title: "Web kit migration 12: hand-rolled accent buttons and links on the sign-in and onboarding pages become the kit Button"
status: todo
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

## Review (written by Claude)
