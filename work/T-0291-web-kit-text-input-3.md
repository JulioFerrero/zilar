---
id: T-0291
title: "Web kit migration 15: Integrations, Connections, New topic name and group handle fields use the kit TextInput"
status: todo
milestone: M5
branch: task/T-0291-web-kit-text-input-3
model: auto
effort: low
depends_on: [T-0290]
estimate: 0.3 day
---

# T-0291: kit TextInput, batch 3

## Spec (written by Claude, do not edit)

### Why
This is batch 3 of moving hand-rolled text fields onto the kit `TextInput` (`apps/web/src/components/ui/text-input.tsx`). T-0288 and T-0290 did batches 1 and 2; read their Reports.

Here, most fields sit inside a wrapping `<label>` with a visible text, and some are password fields with a show/hide button laid over the right end. The simplest safe rule is: **replace only the `<input>` element and keep the label markup around it.**

### Verified facts (do not re-derive)
- **Kit `TextInput`:**
  - takes all `<input>` props plus `label?`, `hint?`, `invalid?` and `counter?`;
  - without `label`, it renders `<div class="flex flex-col gap-1.5"><input class="well-surface w-full rounded-lg px-3 py-2 text-sm …"/></div>`;
  - `className` goes to the `<input>`.
- **`apps/web/src/routes/IntegrationsPage.tsx`:** six inputs.
  - Plain inputs inside `<label className="flex flex-col gap-1 text-[14px]">Visible text<input aria-label=…/></label>`:
    - line 221 "From address";
    - line 373 "Base URL";
    - line 385 "Model".
  - Password inputs with a toggle:
    - line 239, "New Resend API key", `type={showKey ? 'text' : 'password'}`;
    - line 398, "API key";
    - line 532, "Bot token".
    - Each sits inside `<span className="relative">` next to an absolute show/hide `<button>`, with input class `… py-2 pr-10 pl-3 …`.
  - Several are `disabled={busy}`.
- **`apps/web/src/routes/ConnectionsPage.tsx`:**
  - line 340: password input with a toggle, inside `<div className="relative">` in a wrapping label "API key";
  - line 363: "Label (optional)" input in a wrapping label.
  - The `<select>` at line 324 stays as it is.
- **`apps/web/src/components/NewTopicDialog.tsx`** line 217: `aria-label="Topic name"` input in a wrapping label "Name". It already uses `well-surface rounded-[10px]` by hand.
- **`apps/web/src/components/VisibilitySection.tsx`** lines 166-186: `<label htmlFor={`visibility-handle-${groupId}`}>Handle</label>` plus `<input id=…>`.
- **Tests:** `apps/web/src/routes/IntegrationsPage.test.tsx`, `apps/web/src/routes/ConnectionsPage.test.tsx`, `apps/web/src/components/NewTopicDialog.test.tsx`, `apps/web/src/components/VisibilitySection.test.tsx`.

### What to build
1. **Wrapped-label fields:** replace only the `<input>` with `<TextInput …>`. Keep the outer `<label>` and its visible text, and keep `aria-label`, `value`, `onChange`, `type`, `maxLength`, `placeholder`, `autoComplete` and `disabled`.
2. **Password fields with a toggle:**
   - the `TextInput` gets `className="pr-10"` so the text clears the button;
   - change the `<span className="relative">` wrappers in IntegrationsPage to `<div className="relative">`, because a `div` must not sit inside a `span`;
   - the toggle button stays where it is.
3. **VisibilitySection handle:** becomes `<TextInput id={`visibility-handle-${groupId}`} label="Handle" …>`, and the hand-rolled `<label>` goes, as in T-0288.
4. **NewTopicDialog name:** becomes `TextInput`, and its hand-rolled `well-surface` classes go.
5. **Tests:**
   - existing tests keep passing, changed only where they relied on the old markup;
   - add one `well-surface` assertion per test file.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/text-input.tsx`, `work/T-0290-web-kit-text-input-2.md` (Report), and the four files with their tests.

### Allowed files
`apps/web/src/routes/IntegrationsPage.tsx`, `apps/web/src/routes/IntegrationsPage.test.tsx`, `apps/web/src/routes/ConnectionsPage.tsx`, `apps/web/src/routes/ConnectionsPage.test.tsx`, `apps/web/src/components/NewTopicDialog.tsx`, `apps/web/src/components/NewTopicDialog.test.tsx`, `apps/web/src/components/VisibilitySection.tsx`, `apps/web/src/components/VisibilitySection.test.tsx`, `work/T-0291-web-kit-text-input-3.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot IntegrationsPage ConnectionsPage NewTopicDialog VisibilitySection
pnpm gate
```

### Acceptance
- Raw `<input>` elements left in the four files are only `type="checkbox"` or `type="radio"`. The `<select>` elements stay.
- Accessible names, show/hide toggles and behaviour are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
- `FolderEditorDialog`: its borderless inline name field and icon search are deliberate;
- composer, search bar, `OtpInput`, file inputs.

---

## Report (written by the worker when done)

## Review (written by Claude)
