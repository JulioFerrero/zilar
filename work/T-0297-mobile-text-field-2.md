---
id: T-0297
title: "Mobile kit migration: integrations, connections, AI edit and invite-link fields use the kit TextField"
status: todo
milestone: M5
branch: task/T-0297-mobile-text-field-2
model: auto
effort: low
depends_on: [T-0294]
estimate: 0.3 day
---

# T-0297: mobile TextField, batch 2

## Spec (written by Claude, do not edit)

### Why
T-0294 added the mobile kit `TextField` (`apps/mobile/src/components/ui/text-field.tsx`) and moved five fields onto it. QA run 12 passed on the emulator. This batch moves eleven more. Read `work/T-0294-mobile-kit-text-field.md` (Report) first.

### Verified facts (do not re-derive)
- **`TextField`:**
  - a pass-through RN `TextInput` with the well look: `rounded-[10px] border border-border-strong bg-well px-3 py-2 text-[15px] text-foreground`;
  - a default `placeholderTextColor` of `MUTED_FOREGROUND[scheme]`;
  - `className` merged with `cn`, and `textAlignVertical: 'top'` for `multiline`;
  - an optional `label`.
- **`apps/mobile/src/app/settings/integrations.tsx`:**
  - line 182: the secret field, `secureTextEntry={!show}`, `className="min-w-0 flex-1 rounded-lg border …"`, in a `flex-row` with a show/hide `Pressable`;
  - line 390: "From address";
  - line 538: "Base URL";
  - line 555: "Model".
  - All use `placeholderTextColor={MUTED_FOREGROUND[scheme]}` and `className="rounded-lg border border-input bg-background px-3 py-2 text-[15px] text-foreground"`.
- **`apps/mobile/src/app/settings/connections.tsx`:**
  - line 446: "API key", `secureTextEntry`, `min-w-0 flex-1 …`, with a toggle;
  - line 475: "Label".
- **`apps/mobile/src/app/ais/[id].tsx`:**
  - line 260: "Name", `py-2.5`;
  - line 271: "Persona", `multiline`, `min-h-[150px]`.
- **`apps/mobile/src/components/chat/invite-links-sheet.tsx`:** lines 191, 206 and 221 are fields inside `View className="… rounded-[10px] border border-border-strong bg-well px-3 py-2"` wrappers, with `placeholderTextColor="#8a8a8a"` and `className="text-[15px] text-foreground"`.
  - "Expiry in hours" and "Max uses" sit side by side in `flex-1` Views.
- **Tests that import these files.** Add mocks only, if the new `TextField` import needs them; see the pitfall in `docs/LEAD_HANDOFF.md` and how T-0294 handled `nativewind`:
  - `apps/mobile/src/components/chat/invite-links-sheet.test.tsx`;
  - `apps/mobile/src/components/connections/connections-screen.test.tsx`;
  - `apps/mobile/src/components/integrations/integrations-screen.test.tsx`;
  - `apps/mobile/src/components/integrations/integrations-api.test.ts`.

### What to build
1. Every field listed above becomes `TextField`:
   - keep every prop: value, handlers, `accessibilityLabel`, `secureTextEntry`, `autoCapitalize`, `autoCorrect`, `autoComplete`, `maxLength`, `editable`, `returnKeyType`, `placeholder`, `multiline`, `keyboardType`;
   - drop the hand-written style and placeholder colour;
   - keep only layout classes: `min-w-0 flex-1` for the toggle rows, and `min-h-[150px]` for the persona.
2. **invite-links-sheet:**
   - remove the well wrapper `View`s, because `TextField` is the well;
   - the side-by-side pair keeps its `flex-1` columns;
   - remove the `#8a8a8a`.
3. **Tests:** existing tests keep passing. Change the test files listed above only to add mocks.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the mobile test mocks pitfall), `apps/mobile/src/components/ui/text-field.tsx`, `work/T-0294-mobile-kit-text-field.md` (Report), the four files and the four tests.

### Allowed files
`apps/mobile/src/app/settings/integrations.tsx`, `apps/mobile/src/app/settings/connections.tsx`, `apps/mobile/src/app/ais/[id].tsx`, `apps/mobile/src/components/chat/invite-links-sheet.tsx`, `apps/mobile/src/components/chat/invite-links-sheet.test.tsx`, `apps/mobile/src/components/connections/connections-screen.test.tsx`, `apps/mobile/src/components/integrations/integrations-screen.test.tsx`, `apps/mobile/src/components/integrations/integrations-api.test.ts`, `work/T-0297-mobile-text-field-2.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot invite-links-sheet connections-screen integrations
pnpm gate
```

### Acceptance
- The eleven fields render through `TextField`, and none of the four source files hard-codes a placeholder colour.
- Labels, toggles and behaviour are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
