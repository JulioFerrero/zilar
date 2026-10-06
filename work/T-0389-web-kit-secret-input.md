---
id: T-0389
title: "Web kit: a SecretInput (TextInput with a built-in show/hide toggle) replaces the four hand-rolled key and token fields on Connections and Integrations"
status: merged
milestone: M5
branch: task/T-0389-web-kit-secret-input
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0389: kit SecretInput

## Spec (written by Claude, do not edit)

### Why
Four screens copy the same password field: a `TextInput` with `pr-10`, a `showX` state, and an absolute Eye/EyeOff button.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/text-input.tsx`:**
  - exports `FIELD_INPUT` (line 51) and `TextInput` (line 54, `ComponentProps<'input'> & { label?, hint?, invalid?, counter? }`);
  - when `label`, `hint` and `counter` are all undefined, `TextInput` returns the bare `<input>`;
  - `cn` merges a caller `className`.
- `apps/web/src/components/ui/button.tsx`: `ghost` variant, size `icon-sm` (size-7).
- **The four copies.** Each is a `<div className="relative">` holding `<TextInput type={shown ? 'text' : 'password'} … className="pr-10" />` and a `<button type="button" aria-label={shown ? 'Hide X' : 'Show X'} title={same} onClick={toggle} className="absolute top-1/2 right-1 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground hover:bg-muted">{shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>`:

| File | `TextInput` line | State | Labels |
| --- | --- | --- | --- |
| `apps/web/src/routes/ConnectionsPage.tsx` | 334 | `showKey` (line 276) | "Show key" / "Hide key" |
| `apps/web/src/routes/IntegrationsPage.tsx` | 239 | `showKey` (line 168) | "Show key" / "Hide key" |
| same | 396 | `showKey` (line 292) | "Show key" / "Hide key" |
| same | 525 | `showToken` (line 451) | "Show token" / "Hide token" |

- **Imports:** `Eye, EyeOff` come from lucide in `ConnectionsPage.tsx:3` and `IntegrationsPage.tsx:3`.
- **Tests:**
  - `apps/web/src/routes/ConnectionsPage.test.tsx`;
  - `apps/web/src/routes/IntegrationsPage.test.tsx`;
  - the kit test `apps/web/src/components/ui/kit.test.tsx` (it has a `describe('TextInput and TextArea')` at line 90);
  - the fixture file `apps/web/src/components/ui/text-input.fixture.tsx`.

### What to build
1. **In `text-input.tsx`**, export `SecretInput(props: Omit<TextInputProps, 'type'> & { revealLabel?: { show: string; hide: string } })`:
   - It keeps its own `shown` state.
   - It renders `<div className="relative">` with `<TextInput {...props} type={shown ? 'text' : 'password'} className={cn('pr-10', props.className)} />`.
   - It adds a kit `<Button type="button" variant="ghost" size="icon-sm" aria-label={shown ? hide : show} title={same} onClick={toggle} className="absolute top-1/2 right-1 -translate-y-1/2 rounded-full text-muted-foreground">` with `EyeOff` or `Eye` at `size-4`, `aria-hidden`.
   - `revealLabel` defaults to `{ show: 'Show key', hide: 'Hide key' }`.
   - Import `Button` from `./button` and the icons from `lucide-react`.
2. **Use it in the four places.** Pass the same `value`, `onChange`, `aria-label`, `placeholder`, `maxLength`, `autoComplete`, `disabled` and other props. Pass `revealLabel={{ show: 'Show token', hide: 'Hide token' }}` for the bot token.
3. **Clean up:** remove the four `showX` states, the wrapper `div`s and the now-unused `Eye`/`EyeOff` imports in the two routes.
4. **Fixture:** add a `SecretInput` example to `text-input.fixture.tsx`.
5. **Kit test:** add cases to `kit.test.tsx` checking that:
   - the field starts as `type="password"` and the button is labelled "Show key";
   - clicking it switches the field to `text` and the label to "Hide key";
   - a custom `revealLabel` is used.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/text-input.tsx`, `apps/web/src/components/ui/button.tsx`, `apps/web/src/routes/ConnectionsPage.tsx:270-355` and `apps/web/src/routes/IntegrationsPage.tsx:160-260`, `:285-420` and `:445-550`.

### Allowed files
`apps/web/src/components/ui/text-input.tsx`, `apps/web/src/components/ui/text-input.fixture.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/routes/ConnectionsPage.tsx`, `apps/web/src/routes/IntegrationsPage.tsx`, `apps/web/src/routes/ConnectionsPage.test.tsx`, `apps/web/src/routes/IntegrationsPage.test.tsx`, `work/T-0389-web-kit-secret-input.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit ConnectionsPage IntegrationsPage
pnpm gate
```

### Acceptance
- No `showKey` or `showToken` state, and no `Eye`/`EyeOff` import, remain in the two routes.
- `SecretInput` has a fixture and kit tests.
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

- Added `SecretInput` to `apps/web/src/components/ui/text-input.tsx`: a component typed
  `Omit<TextInputProps, 'type'> & { revealLabel?: { show: string; hide: string } }` that keeps its own
  `shown` state, renders `<div className="relative">` wrapping `TextInput` with
  `type={shown ? 'text' : 'password'}` and `className={cn('pr-10', className)}`, plus a kit `Button`
  (`type="button"`, `variant="ghost"`, `size="icon-sm"`, `aria-label`/`title` from the label,
  `Eye`/`EyeOff` at `size-4` with `aria-hidden`). `revealLabel` defaults to
  `{ show: 'Show key', hide: 'Hide key' }`.
- Replaced the four hand-rolled fields with `SecretInput`:
  - `ConnectionsPage.tsx` — provider API key.
  - `IntegrationsPage.tsx` — Resend API key, voice transcription API key, and Telegram bot token
    (`revealLabel={{ show: 'Show token', hide: 'Hide token' }}`).
- Removed the four `showKey`/`showToken` states, the wrapper `div`s and the `Eye`/`EyeOff` imports
  from both routes.
- Added a `SecretInput` example to `text-input.fixture.tsx`.
- Added three kit tests to `kit.test.tsx`: starts as `type="password"` with a "Show key" button;
  clicking toggles to `type="text"`/ "Hide key" and back; a custom `revealLabel` is used.

### Files changed

- `apps/web/src/components/ui/text-input.tsx`
- `apps/web/src/components/ui/text-input.fixture.tsx`
- `apps/web/src/components/ui/kit.test.tsx`
- `apps/web/src/routes/ConnectionsPage.tsx`
- `apps/web/src/routes/IntegrationsPage.tsx`
- `work/T-0389-web-kit-secret-input.md`

`ConnectionsPage.test.tsx` and `IntegrationsPage.test.tsx` were not edited: their existing
"Show key"/"Hide key" queries still match the new component and still pass.

### Commands and real results

- `pnpm install` — success (1170 packages).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit ConnectionsPage IntegrationsPage` —
  `Test Files 3 passed (3)`, `Tests 77 passed (77)`.
- `pnpm gate` — first run `GATE FAIL` at `format` (prettier) for `kit.test.tsx` and `text-input.tsx`;
  fixed with `pnpm exec prettier --write` on those two files. Second run:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (32.6s)
PASS  lint  (2.2s)
PASS  typecheck  (16.7s)
PASS  tests @zilar/web  (34.6s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Deviations / notes

- No behavioural deviation. The old raw toggle `<button>` (`p-1.5`, `hover:bg-muted`) is replaced by
  the kit `Button` exactly as the spec prescribes.
- `SecretInput` always renders its `div.relative` wrapper, even when `TextInput` returns a bare
  input (no label/hint/counter), which is required for the absolutely-positioned toggle.

### Open questions

- None.

## Review (written by Claude)

Approved (lead, 2026-10-06). Kit `SecretInput` owns its show/hide state with a kit ghost icon toggle and a `revealLabel` override; the four copies on Connections and Integrations use it, and their states and Eye imports are gone. It has a fixture and kit tests. Pre-review clean (0 findings). Lead note for later: with `label`/`hint`, `TextInput` wraps itself in a Field, so the absolute toggle would centre on the whole field. No caller passes those today; if one does, move the relative wrapper inside the Field.
