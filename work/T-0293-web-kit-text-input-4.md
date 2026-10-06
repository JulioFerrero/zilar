---
id: T-0293
title: "Web kit migration 16: setup, new-AI, AI panel and spending-limit fields use the kit TextInput / TextArea"
status: todo
milestone: M5
branch: task/T-0293-web-kit-text-input-4
model: auto
effort: low
depends_on: [T-0292]
estimate: 0.3 day
---

# T-0293: kit TextInput, batch 4

## Spec (written by Claude, do not edit)

### Why
This is batch 4 of moving hand-rolled text fields onto the kit `TextInput` / `TextArea` (`apps/web/src/components/ui/text-input.tsx`). Read the Reports of T-0288 to T-0292 first.

Since T-0292, a field with no `label`, `hint` or `counter` renders as the bare `<input>` / `<textarea>`, so it can sit inside an existing wrapping `<label>`.

### Verified facts (do not re-derive)
- **`apps/web/src/routes/SetupPage.tsx`:** three `<label htmlFor=…>` + `<input id=…>` pairs inside a `flex flex-col gap-3` form, each styled with `className={inputClassName}` (line 13):
  - lines 164-175: "Admin email", id `setup-admin-email`, `type="email"`;
  - lines 187-198: "Resend API key", id `setup-resend-key`, `type="password"`;
  - lines 203-213: "From address", id `setup-from`.
  - A `-mt-1` help `<p>` follows the last two fields.
- **`apps/web/src/components/ais/NewAiDialog.tsx`:**
  - line 220: `aria-label="Name"` input inside `<label className="flex flex-col gap-1"><span>Name</span>…</label>`, `autoFocus`, `maxLength={64}`;
  - line 305: `aria-label="Persona"` textarea in the same pattern, `rows={5}`, `maxLength={4000}`.
- **`apps/web/src/components/ais/AiPanel.tsx`:**
  - line 536: `aria-label="Name"` input in a wrapping label;
  - line 550: `aria-label="Persona"` textarea, `rows={10}`.
- **`apps/web/src/components/ais/LimitsFields.tsx`:**
  - lines 25 and 41: `aria-label="Per day amount"` / `"Per month amount"` inputs, `inputMode="decimal"`, class `w-32 …`;
  - each sits in a `flex items-center gap-2` row after a `$` span, inside a wrapping label.
  - It is tested through `apps/web/src/components/ais/AiPanel.test.tsx`.
- **Tests:** `apps/web/src/routes/SetupPage.test.tsx`, `apps/web/src/components/ais/NewAiDialog.test.tsx`, `apps/web/src/components/ais/AiPanel.test.tsx`.

### What to build
1. **SetupPage:**
   - each pair becomes `<TextInput id="…" label="…" type=… autoComplete=… …>`;
   - the hand-rolled `<label>` goes, and `inputClassName` is deleted if nothing uses it any more;
   - the help paragraphs stay after their field. Put them in the kit `hint` only if that keeps the same text; otherwise keep the `<p>`.
2. **NewAiDialog, AiPanel and LimitsFields:**
   - replace only the `<input>` / `<textarea>` with `TextInput` / `TextArea`, keeping the wrapping label, `aria-label`, `rows`, `maxLength`, `inputMode`, `autoFocus` and handlers;
   - `TextArea` keeps its `rows` height: pass `className="min-h-0"` so the kit's `min-h-20` does not override `rows`;
   - LimitsFields keeps `className="w-32"`; `cn` / tailwind-merge replaces the kit's `w-full`.
3. **Tests:**
   - existing tests keep passing, changed only where they relied on the old markup;
   - add one `well-surface` assertion per test file.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/text-input.tsx`, `work/T-0291-web-kit-text-input-3.md` and `work/T-0292-web-kit-field-no-wrapper.md` (Reports), the four files and the three tests.

### Allowed files
`apps/web/src/routes/SetupPage.tsx`, `apps/web/src/routes/SetupPage.test.tsx`, `apps/web/src/components/ais/NewAiDialog.tsx`, `apps/web/src/components/ais/NewAiDialog.test.tsx`, `apps/web/src/components/ais/AiPanel.tsx`, `apps/web/src/components/ais/AiPanel.test.tsx`, `apps/web/src/components/ais/LimitsFields.tsx`, `work/T-0293-web-kit-text-input-4.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot SetupPage NewAiDialog AiPanel
pnpm gate
```

### Acceptance
- No raw text `<input>` or `<textarea>` is left in the four files.
- Ids, accessible names, texts and behaviour are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
