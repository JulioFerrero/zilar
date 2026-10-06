---
id: T-0403
title: "Web kit: SecretInput keeps its eye toggle centred on the input when given a label, hint or counter"
status: merged
milestone: M5
branch: task/T-0403-web-secret-input-label-safe
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0403: SecretInput safe with label and hint

## Spec (written by Claude, do not edit)

### Why
The T-0389 review found a latent bug: with a `label`, `hint` or `counter`, `TextInput` wraps itself in a `Field`. `SecretInput`'s absolute toggle then centres on the whole field instead of the input. No caller passes those props yet.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/text-input.tsx`:**
  - `Field({ id, label, hint, invalid, children })` renders a `flex flex-col gap-1.5` `div` with the label, the children and the hint;
  - `TextInput` returns the bare `<input>` when `label`, `hint` and `counter` are all undefined; otherwise it returns a `Field` containing the input and the optional counter;
  - `SecretInput` (T-0389) renders `<div className="relative"><TextInput {...props} type=… className={cn('pr-10', className)} /><Button … className="absolute top-1/2 right-1 -translate-y-1/2 …">`.
- **Tests:** `apps/web/src/components/ui/kit.test.tsx` has SecretInput cases. The fixture is `apps/web/src/components/ui/text-input.fixture.tsx`.

### What to build
1. Make `SecretInput` put the `relative` wrapper around the `<input>` only, so the toggle stays centred on it. Either:
   - render `Field` itself around a `relative` div holding a bare `TextInput` and the toggle; or
   - give `TextInput` an internal `trailing` slot.

   Keep the current behaviour and markup when no `label`, `hint` or `counter` is given.
2. Add a kit test: with `label="API key"` and `hint="…"`, the label renders, the toggle works, and the toggle's parent element is the same element that contains the input (not the Field root).
3. Add a labelled example to the fixture.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/text-input.tsx` and the SecretInput cases in `apps/web/src/components/ui/kit.test.tsx`.

### Allowed files
`apps/web/src/components/ui/text-input.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/ui/text-input.fixture.tsx`, `work/T-0403-web-secret-input-label-safe.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit ConnectionsPage IntegrationsPage
pnpm gate
```

### Acceptance
- A labelled `SecretInput` keeps the toggle on the input.
- The existing callers are unchanged.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- Chose the spec's option 2: `TextInput` gained an optional internal `trailing` slot. When `trailing` is set, `TextInput` wraps only the `<input>` and the trailing node in the `relative` div; the `Field` (label/hint/counter) is built around that. The eye toggle's parent is now the same element that contains the input, not the `Field` root, so it stays centred on the input.
- `SecretInput` no longer renders its own `relative` wrapper; it passes the toggle through `trailing`. With no `label`, `hint` or `counter` the rendered DOM is unchanged: `div.relative > input + button`.
- Added a kit test for a labelled `SecretInput` with a hint; it checks the label and hint render, the toggle works, the toggle's parent equals the input's parent and is a `relative` element (not the `flex-col` Field root).
- Added a `SecretInputWithHint` labelled example to the fixture.

### Files changed
- `apps/web/src/components/ui/text-input.tsx` — optional `trailing` slot on `TextInputProps`; `TextInput` wraps input+trailing in `relative`; `SecretInput` passes the toggle via `trailing`.
- `apps/web/src/components/ui/kit.test.tsx` — new test `keeps the eye toggle on the input when a labelled SecretInput has a hint`.
- `apps/web/src/components/ui/text-input.fixture.tsx` — new `SecretInputWithHint` example.
- `work/T-0403-web-secret-input-label-safe.md` — status + this report.

### Commands run
- `pnpm install` → done in 17.4s, exit 0.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit ConnectionsPage IntegrationsPage` → Test Files 3 passed (3), Tests 78 passed (78), exit 0.
- `pnpm gate` (repo root) → `gate: 4 changed file(s) against main`; `PASS install (frozen) (2.0s)`; `PASS format (65.8s)`; `PASS lint (3.1s)`; `PASS typecheck (44.1s)`; `PASS tests @zilar/web (49.5s)`; `scope: every changed file is inside the Allowed files`; `GATE PASS`.

### Problems / deviations
- Used spec option 2 (`trailing` slot); no `Field` duplication.
- The fixture already had a labelled `SecretInput` example from T-0389, so the new example adds a `hint` to exercise the fixed layout.
- Verified no existing caller passes `label`/`hint`/`counter` (ConnectionsPage and IntegrationsPage use external `<label>` + `aria-label`), so caller markup is unchanged.

### Security checklist
- No secrets read, printed or logged. UI-only change: no routes, queries, permissions, caps or audit paths touched.

## Review (written by Claude)

**2026-10-06, lead:** approved. The pre-review was clean. `TextInput` gets a `trailing` slot wrapped in a `relative` div around the input only, inside `Field` when there is a label. Without a label, the markup is the same as before (`div.relative > input + button`), so the existing callers do not change.
