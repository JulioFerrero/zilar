---
id: T-0403
title: "Web kit: SecretInput keeps its eye toggle centred on the input when given a label, hint or counter"
status: todo
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

## Review (written by Claude)
