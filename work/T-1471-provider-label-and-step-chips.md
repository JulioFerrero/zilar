---
id: T-1471
title: "New AI / Add key parity: the Provider field shows \"OpenAI-compatible\" when it is chosen (web showed the raw id, mobile \"Select…\"); the mobile step chips stay on one line and name the model as web does"
status: merged
milestone: M5
branch: task/T-1471-provider-label-and-step-chips
model: auto
effort: default
depends_on: [T-1445]
estimate: 0.2 day
---

# T-1471: Provider label and step chips

## Spec (written by Claude, do not edit)

### Why
The lead's emulator walk of T-1445 (OpenAI-compatible) and a headless web check, 2026-10-15:
- **Web:** after "OpenAI-compatible" is picked, the Provider trigger reads `openai-compatible`, the raw id.
- **Mobile:** after the same pick, the Provider field reads "Select…".
- **Mobile step chips:**
  - the first chip wraps "OpenAI-compati / ble" onto two lines;
  - the Model chip turned the id `llama-3-70b` into "3 70b".

### Facts (the lead read them on main `ba7a331a8`, 2026-10-15)
- **Web `apps/web/src/components/ui/combobox.tsx`** (163 lines):
  - `ComboboxFooterItem` is `{ label, onSelect }` (`:9-12`);
  - the trigger renders `<BaseCombobox.Value placeholder={triggerPlaceholder} />` (`:93`);
  - the items are only `options` (`:68-75`), so a value that equals the footer's choice is not an item, and Base UI shows the raw value.
- **Web `apps/web/src/components/ais/new-ai/ProviderStep.tsx:10-27`:** the options drop `openai-compatible`, and the `footerItem` picks it.
- **Mobile `apps/mobile/src/components/ui/select-sheet.tsx`:**
  - `SelectSheetFooterOption` is `{ label, onPress }` (`:19-23`);
  - the trigger label is `selected?.label ?? placeholder`, with `selected` coming from `options` only (`:63`, `:85`, `:95`).
- **Mobile `apps/mobile/src/components/ais/new-ai/provider-step.tsx`:** the options drop `openai-compatible` (`:16-22`), and `footerOption` picks it (`:34-37`).
- **Mobile `apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx`:**
  - `shortModelLabel` keeps the last two words of the model **id** (`:20-24`);
  - it is used for the Model chip (`:57`).
  - Web labels the Model step with the catalog model **name** minus a leading `"<provider label> "` (`apps/web/src/components/ais/new-ai/useNewAiFlow.ts:186-191`).
- **Mobile `apps/mobile/src/components/ui/step-track.tsx:73`:** the chip `<Text>` has no `numberOfLines`, so a long label wraps.

### What to build
1. **Footer value, web and mobile.** Both footer types gain an optional `value?: string`.
   - When the field's `value` equals `footerItem.value` (web) or `footerOption.value` (mobile), the trigger shows the footer's label.
   - Web: render a plain truncating `<span>` with that label in place of `<BaseCombobox.Value>`. Keep `<BaseCombobox.Value>` for every other case.
   - Mobile: the trigger label and its `accessibilityLabel` use it.
   - Both `ProviderStep.tsx` and `provider-step.tsx` pass `value: 'openai-compatible'`.
2. **Mobile chip labels:**
   - `step-track.tsx` gives the chip `<Text>` `numberOfLines={1}` and lets it shrink (`shrink` / `min-w-0` on the text), so long labels end in "…";
   - in `new-ai-sheet.tsx`, replace `shortModelLabel` with the web rule: the model option's label (`flow.modelOptions` entry for `flow.model`, else the raw id) minus a leading `"<provider label> "`.
3. **Every file stays at 400 lines or fewer.**

### Tests
None (UI).

### Allowed files
- `apps/web/src/components/ui/combobox.tsx`, `apps/web/src/components/ais/new-ai/ProviderStep.tsx`
- `apps/mobile/src/components/ui/select-sheet.tsx`, `apps/mobile/src/components/ais/new-ai/provider-step.tsx`, `apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx`, `apps/mobile/src/components/ui/step-track.tsx`
- `work/T-1471-provider-label-and-step-chips.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- The lead's checks show "OpenAI-compatible" in the Provider field on web (headless) and on the emulator, and one-line chips.

---

## Report (written by the worker when done)

### What I did

1. **Footer value, web** (`apps/web/src/components/ui/combobox.tsx`): added an optional
   `value?: string` to `ComboboxFooterItem`. The trigger now renders the footer's label in a
   plain truncating `<span>` when `footerItem.value === value`, and keeps
   `<BaseCombobox.Value placeholder={triggerPlaceholder} />` for every other case.
2. **Web `ProviderStep.tsx`**: the `Combobox` footer item now passes
   `value: 'openai-compatible'`, so picking "OpenAI-compatible" shows that label instead of the
   raw id.
3. **Footer value, mobile** (`apps/mobile/src/components/ui/select-sheet.tsx`): added an optional
   `value?: string` to `SelectSheetFooterOption`. A new `currentLabel` uses the footer's label
   when `footerOption.value === value`, else `selected?.label ?? placeholder`. Both the trigger
   `<Text>` and the `accessibilityLabel` use it.
4. **Mobile `provider-step.tsx`**: the `SelectSheet` `footerOption` now passes
   `value: 'openai-compatible'`, so the Provider row reads "OpenAI-compatible" instead of
   "Select…".
5. **Mobile chip labels** (`apps/mobile/src/components/ui/step-track.tsx`): the chip `<Text>` now
   has `numberOfLines={1}` and `min-w-0 shrink`, so a long label truncates with "…" on one line.
6. **Mobile Model chip** (`apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx`): removed
   `shortModelLabel` and used the web rule instead — the `flow.modelOptions` entry for
   `flow.model` (else the raw id), minus a leading `"<provider label> "`. `llama-3-70b` now stays
   `llama-3-70b` instead of becoming "3 70b".

No tests added: the spec says Tests: None (UI). Every changed file is well under 400 lines.

### Files changed
- `apps/web/src/components/ui/combobox.tsx`
- `apps/web/src/components/ais/new-ai/ProviderStep.tsx`
- `apps/mobile/src/components/ui/select-sheet.tsx`
- `apps/mobile/src/components/ais/new-ai/provider-step.tsx`
- `apps/mobile/src/components/ais/new-ai/new-ai-sheet.tsx`
- `apps/mobile/src/components/ui/step-track.tsx`
- `work/T-1471-provider-label-and-step-chips.md`

### Commands run
- `pnpm install`: done in 16.4 s (no errors; one pre-existing peer-dependency warning in
  `apps/mobile`).
- `pnpm exec prettier --write <the six changed source files>`: formatted them (only
  `new-ai-sheet.tsx` and `step-track.tsx` changed).
- `pnpm gate` (from the repo root):
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (0.8s)
  PASS  lint  (1.3s)
  PASS  typecheck  (5.6s)
  PASS  effect  (1.7s)
  PASS  tests @zilar/mobile  (2.9s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test file was run before the gate (the spec says there are none for this task).

### Deviations from the spec
- None.

### Blocked / needs a decision
- None.

### Notes
- I did not run the emulator or a headless web check myself; the acceptance asks for the lead's
  checks. The code paths match the spec.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 0.
- **Web** (headless, Add key): the Provider trigger reads "OpenAI-compatible", no longer the raw id.
- **Emulator:**
  - the Provider field reads "OpenAI-compatible";
  - the step chips stay on one line ("OpenAI-co…");
  - the Model chip shows "llama-3-70b" instead of "3 70b".
