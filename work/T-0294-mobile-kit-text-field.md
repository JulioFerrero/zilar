---
id: T-0294
title: "Mobile kit: TextField; the profile name, handle, add-contact and new-AI fields use it"
status: merged
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
`apps/mobile/src/components/ui/text-field.tsx`, `apps/mobile/src/components/ui/kit.test.tsx`, `apps/mobile/src/app/dev/kit.tsx`, `apps/mobile/src/app/settings/profile.tsx`, `apps/mobile/src/components/settings/handle-field.tsx`, `apps/mobile/src/components/settings/settings-ui.test.tsx`, `apps/mobile/src/components/contacts/add-contact-sheet.tsx`, `apps/mobile/src/app/ais/new.tsx`, `apps/mobile/src/components/contacts/contacts.test.tsx` (the `nativewind` mock only; added by the lead after the worker's BLOCKED), `work/T-0294-mobile-kit-text-field.md`.

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

### Status: ready for review

All the work in the spec is done. The gate first selected
`apps/mobile/src/components/contacts/contacts.test.tsx`, which failed to load because it
lacked a `nativewind` mock (root cause below). The lead allowed that file for the mock
only, so I added one line and `pnpm gate` now ends with `GATE PASS`.

### What I did

- **New `apps/mobile/src/components/ui/text-field.tsx`:** a `React` `TextInput`
  wrapper that passes every prop through, defaults to
  `rounded-[10px] border border-border-strong bg-well px-3 py-2 text-[15px] text-foreground`,
  defaults `placeholderTextColor` to `MUTED_FOREGROUND[scheme]` (caller value kept),
  merges `className` with `cn`, adds `textAlignVertical: 'top'` for `multiline`,
  and renders an optional `label` above the field.
- **Migrated the five fields to `TextField`:**
  - `app/settings/profile.tsx` — "Display name" (`accessibilityLabel`, `maxLength={64}`,
    `editable`, value/handler, `className="mt-1"`).
  - `components/settings/handle-field.tsx` — the @username field (all props kept;
    now also passes `spellCheck={false}` as before).
  - `components/contacts/add-contact-sheet.tsx` — "Username": dropped the wrapper
    `View` and gave `TextField` `className="flex-1"` so the row layout with the
    Look up button is unchanged.
  - `app/ais/new.tsx` — "Name" and "Persona" (`multiline`, `min-h-[150px]`,
    `maxLength={4000}`); the separate `Text` labels are untouched.
- **Catalog:** added a "Text field" section to `app/dev/kit.tsx` with a plain field,
  a labeled field and a multiline field.
- **Tests:** added a `describe('TextField')` to `components/ui/kit.test.tsx` covering
  the default placeholder colour, a caller override, the label present/absent, and
  `className` merging; added `TextInput` to that file's `react-native` mock.
- **`components/contacts/contacts.test.tsx`:** added only
  `vi.mock('nativewind', () => ({ useColorScheme: () => ({ colorScheme: 'dark' }) }));`
  (allowed by the lead). Every existing assertion is unchanged.
- No file among the four migrated ones hard-codes a placeholder colour any more
  (`grep` for `MUTED_FOREGROUND|TextInput|#8a8a8a` returns nothing in all four).

### Why `contacts.test.tsx` needed the mock

`add-contact-sheet.tsx` now imports `TextField`, which imports `useColorScheme` from
`nativewind`. `contacts.test.tsx` imports `resolveContactChat` from `add-contact-sheet`
but did not mock `nativewind`, so Vitest loaded the real `nativewind`, which loads the
real `react-native`. `react-native/index.js:27` uses Flow's `import typeof`, which Node
cannot parse → `SyntaxError: Unexpected token 'typeof'`. `kit.test.tsx` and
`settings-ui.test.tsx` already mocked `nativewind` and were unaffected.

### Files changed

`apps/mobile/src/components/ui/text-field.tsx` (new),
`apps/mobile/src/components/ui/kit.test.tsx`,
`apps/mobile/src/app/dev/kit.tsx`,
`apps/mobile/src/app/settings/profile.tsx`,
`apps/mobile/src/components/settings/handle-field.tsx`,
`apps/mobile/src/components/contacts/add-contact-sheet.tsx`,
`apps/mobile/src/app/ais/new.tsx`,
`apps/mobile/src/components/contacts/contacts.test.tsx` (nativewind mock only),
`work/T-0294-mobile-kit-text-field.md`.

### Commands run (real results)

- `pnpm install` → done, 1287 resolved, no errors (one pre-existing peer warning for
  `@types/react-dom` vs `@types/react`).
- `pnpm exec prettier --write apps/mobile/src/components/ui/kit.test.tsx` → reformatted
  that one file (the first gate run had failed its format check).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit settings-ui contacts`
  → **9 files passed, 130 tests passed**.
- `pnpm gate` (final run):
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (11.3s)
  PASS  lint  (0.4s)
  PASS  typecheck  (4.9s)
  PASS  tests @zilar/mobile  (1.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

Earlier, before the mock: `pnpm gate` → `FAIL tests @zilar/mobile` with
`contacts.test.tsx` (`SyntaxError: Unexpected token 'typeof'`), recorded here for the
history.

## Review (written by Claude)

**Approved.** Clean pre-review after one BLOCKED round: the lead allowed a `nativewind` mock in `contacts.test.tsx`, and the pitfall is now in `docs/LEAD_HANDOFF.md`.
- The five fields use the kit `TextField`, with the well look.
- The migrated files no longer hard-code a placeholder colour.

**Nits accepted:**
- `label=""` would render an empty row; no caller passes one.
- A `style` array can carry an `undefined`, which is harmless.

**Next:** emulator QA in the next run.
