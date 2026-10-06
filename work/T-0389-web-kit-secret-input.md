---
id: T-0389
title: "Web kit: a SecretInput (TextInput with a built-in show/hide toggle) replaces the four hand-rolled key and token fields on Connections and Integrations"
status: todo
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

## Review (written by Claude)
