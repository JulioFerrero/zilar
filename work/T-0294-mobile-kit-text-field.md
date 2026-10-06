---
id: T-0294
title: "Mobile kit: TextField; the profile name, handle, add-contact and new-AI fields use it"
status: todo
milestone: M5
branch: task/T-0294-mobile-kit-text-field
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0294: mobile kit TextField

## Spec (written by Claude, do not edit)

### Why
`apps/mobile/src` has about 30 raw `TextInput`s. Each repeats a style and a placeholder colour by hand, and some hard-code `#8a8a8a`. The web kit field is a recessed "well" (`well-surface` on web, T-0288). The mobile kit gets a `TextField` with the same look, and four simple fields move to it.

### Verified facts (do not re-derive)
- **Common hand-rolled style:**
  - `className="… rounded-lg border border-input bg-background px-3 py-2 text-[15px] text-foreground"`;
  - `placeholderTextColor={MUTED_FOREGROUND[scheme]}`, with `MUTED_FOREGROUND` from `apps/mobile/src/lib/colors.ts:37` and `scheme` from the colour-scheme hook, as `apps/mobile/src/components/ui/action-sheet.tsx` does.
- **Mobile well look:** `apps/mobile/src/components/contacts/add-contact-sheet.tsx:211-223` wraps its `TextInput` in `View className="flex-1 rounded-[10px] border border-border-strong bg-well px-3 py-2"`, and the `TextInput` has `placeholderTextColor="#8a8a8a"` and `className="text-[15px] text-foreground"`. `--well` is defined in `apps/mobile/src/global.css:17`.
- **Fields to migrate:**
  - `apps/mobile/src/app/settings/profile.tsx:346`: "Display name" (`accessibilityLabel`), `maxLength={64}`, `editable={!nameBusy}`;
  - `apps/mobile/src/components/settings/handle-field.tsx:44`: the handle field, tested in `apps/mobile/src/components/settings/settings-ui.test.tsx` (`describe('HandleField states')`, line 139);
  - `apps/mobile/src/components/contacts/add-contact-sheet.tsx:212`: "Username";
  - `apps/mobile/src/app/ais/new.tsx:225` ("Name") and `:245` ("Persona", `multiline`, `min-h-[150px]`, `maxLength={4000}`).
- **Mobile kit:** `apps/mobile/src/components/ui/` (`action-sheet.tsx`, `confirm-dialog.tsx`, `text.tsx`, …), tests in `kit.test.tsx` (stubbed render style), catalog `apps/mobile/src/app/dev/kit.tsx`.

### What to build
1. **`apps/mobile/src/components/ui/text-field.tsx`, `TextField`:**
   - a React Native `TextInput` that passes every prop through;
   - default look: the well, `rounded-[10px] border border-border-strong bg-well px-3 py-2 text-[15px] text-foreground`;
   - `placeholderTextColor` is `MUTED_FOREGROUND[scheme]` unless the caller passes one;
   - `className` is merged with `cn`;
   - for `multiline`, add `textAlignVertical: 'top'`;
   - optional `label` (string): rendered above the field as `text-[14px] font-medium text-foreground` with a small gap. Without `label`, render only the input.
2. **Catalog and tests:**
   - add a "Text field" section to `app/dev/kit.tsx`: one plain field, one with a label, one multiline;
   - kit tests: the placeholder colour default, a caller override, the label rendered or absent, and `className` merged.
3. **Migrate the five fields:**
   - keep every value, handler, `accessibilityLabel`, `maxLength`, `editable`, `autoCapitalize` and `autoCorrect`;
   - add-contact: drop its wrapper `View` and give `TextField` `className="flex-1"`, so it keeps its row layout with the button;
   - the new-AI Persona keeps `min-h-[150px]`.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/action-sheet.tsx`, `apps/mobile/src/components/ui/kit.test.tsx`, `apps/mobile/src/app/dev/kit.tsx`, and the four files plus `settings-ui.test.tsx`.

### Allowed files
`apps/mobile/src/components/ui/text-field.tsx`, `apps/mobile/src/components/ui/kit.test.tsx`, `apps/mobile/src/app/dev/kit.tsx`, `apps/mobile/src/app/settings/profile.tsx`, `apps/mobile/src/components/settings/handle-field.tsx`, `apps/mobile/src/components/settings/settings-ui.test.tsx`, `apps/mobile/src/components/contacts/add-contact-sheet.tsx`, `apps/mobile/src/app/ais/new.tsx`, `work/T-0294-mobile-kit-text-field.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit settings-ui
pnpm gate
```

### Acceptance
- The five fields render through `TextField`, and none of the four files hard-codes a placeholder colour.
- Labels and behaviour are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. If the gate selects another test that breaks only because of mocks, say so in the Report as BLOCKED with the file name.

### Out of scope
The other raw `TextInput`s, including the composer, the OTP input and search fields.

---

## Report (written by the worker when done)

## Review (written by Claude)
