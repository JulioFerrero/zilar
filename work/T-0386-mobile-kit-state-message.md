---
id: T-0386
title: "Mobile kit: a StateMessage component (empty, loading, error, optional action) like the web one, in the dev catalog and the kit test"
status: merged
milestone: M5
branch: task/T-0386-mobile-kit-state-message
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0386: mobile kit StateMessage

## Spec (written by Claude, do not edit)

### Why
The UI kit audit (`docs/audit/ui-kit-audit.md` §2b) lists empty, loading and error states as a P1 kit gap on mobile. 61 mobile files use `ActivityIndicator` directly, and screens hand-write their "Couldn't load …" lines. Web has had `StateMessage` since T-0358. This task adds the mobile component only; adopting it in screens comes in later tasks.

### Verified facts (do not re-derive)
- **Web reference (`apps/web/src/components/ui/state-message.tsx`):**
  - props `kind: 'empty' | 'loading' | 'error'`, `title`, `hint?`, `icon?`, `action?: { label, onClick }` and `size?: 'block' | 'inline'`;
  - `empty` shows the `Inbox` icon and `error` shows `CircleAlert`; `loading` shows a spinner;
  - `block` is a centered column (`gap-2 px-6 py-10`, title `text-[14px] font-medium`, hint `text-[13px] text-muted-foreground`, action is a kit Button);
  - `inline` is a small row with the icon at 14 px and the title at `text-[13px] text-muted-foreground`.
- **Mobile kit (`apps/mobile/src/components/ui/`):**
  - it has `button.tsx`, `text.tsx`, `card.tsx` (`Card`, `SectionLabel`), `search-field.tsx` and others;
  - `search-field.tsx:3,7-8,39` shows the colour pattern: `useColorScheme` from `nativewind`, `asColorScheme` from `@/lib/color-scheme`, and `MUTED_FOREGROUND[scheme]` from `@/lib/colors`;
  - `apps/mobile/src/lib/colors.ts` also exports `DANGER` (line 60, one value) and `ICON`.
  - **Kit Button labels must be inside `<Text>`.** A bare string renders a blank pill (the T-0349 bug).
- **The dev catalog `apps/mobile/src/app/dev/kit.tsx`** (234 lines) renders each kit component under a `SectionLabel` (for example "Buttons" at line 58 and "Count badge" at line 97).
- **The kit test `apps/mobile/src/components/ui/kit.test.tsx`:**
  - renders with `renderToStaticMarkup`;
  - mocks `react-native` (`Modal`, `Pressable`, `TextInput` and `View` as strings), `nativewind` (dark), `lucide-react-native` (named strings), `@/components/ui/text` (`Text: 'Text'`) and `@/components/ui/button` (`Button: 'Button'`);
  - has one `describe` per component.

### What to build
1. **New file `apps/mobile/src/components/ui/state-message.tsx`** exporting `StateMessage` with the same props as web, except `action?: { label: string; onPress: () => void }`.
   - **`block`:** a centered `View`.
     - `loading` shows an `ActivityIndicator` coloured `MUTED_FOREGROUND[scheme]` with `accessibilityLabel={title}`.
     - `empty` and `error` show a lucide icon (`Inbox` or `CircleAlert`, or the `icon` prop) at 20 px, coloured `DANGER` for `error` and muted otherwise.
     - Below that come the title `<Text>`, the optional hint `<Text>`, and the optional `<Button size="sm"><Text>{action.label}</Text></Button>`.
     - Give an `error` root `accessibilityRole="alert"`.
   - **`inline`:** a row with a 14 px icon or a small `ActivityIndicator`, and the title in muted 13 px text.
2. **Catalog:** add a "State messages" section to `apps/mobile/src/app/dev/kit.tsx` showing all three kinds in block size, plus one inline loading.
3. **Kit test:** add a `describe('StateMessage')` to `apps/mobile/src/components/ui/kit.test.tsx` checking:
   - the title and hint render;
   - `error` carries the alert role;
   - `loading` renders the spinner with the title as its label;
   - the action label is inside `Text` within `Button`.

   Extend the existing `react-native` and `lucide-react-native` mocks with `ActivityIndicator`, `Inbox` and `CircleAlert` (mocks only).

### Read first
`AGENTS.md`, `apps/web/src/components/ui/state-message.tsx`, `apps/mobile/src/components/ui/search-field.tsx`, `apps/mobile/src/components/ui/card.tsx`, `apps/mobile/src/app/dev/kit.tsx` and `apps/mobile/src/components/ui/kit.test.tsx`.

### Allowed files
`apps/mobile/src/components/ui/state-message.tsx`, `apps/mobile/src/app/dev/kit.tsx`, `apps/mobile/src/components/ui/kit.test.tsx`, `work/T-0386-mobile-kit-state-message.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit
pnpm gate
```

### Acceptance
- `StateMessage` exists with the API above and is shown in the dev catalog.
- The new kit tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- Added `apps/mobile/src/components/ui/state-message.tsx`: exports `StateMessage` with the web API, except `action` uses `onPress`. `block` is a centered `View`; `empty`/`error` show `Inbox`/`CircleAlert` (or a custom `icon`) at 20 px, muted except `DANGER` for `error`; `loading` shows an `ActivityIndicator` coloured `MUTED_FOREGROUND[scheme]` and labelled with the title; then the title `Text`, optional hint `Text`, and an optional `Button size="sm"` whose label is wrapped in `Text`. `error` roots get `accessibilityRole="alert"`. `inline` is a muted 13 px row with a 14 px icon or a small spinner.
- Added a "State messages" section to `apps/mobile/src/app/dev/kit.tsx` with the three block kinds and one inline loading.
- Added `describe('StateMessage')` to `apps/mobile/src/components/ui/kit.test.tsx` and extended the `react-native` and `lucide-react-native` mocks with `ActivityIndicator`, `Inbox` and `CircleAlert`.

### Files changed
- `apps/mobile/src/components/ui/state-message.tsx` (new)
- `apps/mobile/src/app/dev/kit.tsx`
- `apps/mobile/src/components/ui/kit.test.tsx`
- `work/T-0386-mobile-kit-state-message.md`

### Commands and results
- `pnpm install` -> done, 13 workspace projects, no errors.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit` -> `Test Files 1 passed (1)`, `Tests 30 passed (30)`.
- `pnpm gate` -> `GATE PASS`:
  - `PASS  install (frozen)  (1.5s)`
  - `PASS  format  (20.2s)`
  - `PASS  lint  (1.0s)`
  - `PASS  typecheck  (9.1s)`
  - `PASS  tests @zilar/mobile  (2.7s)`
  - `scope: every changed file is inside the Allowed files`
  The first gate run failed on `format` (`apps/mobile/src/app/dev/kit.tsx`); I fixed it with `pnpm exec prettier --write apps/mobile/src/app/dev/kit.tsx` and re-ran the gate, which passed.

### Deviations / open questions
- The spec asks only for the `error` alert role (web also sets a `status` role for loading); I implemented only the alert role, as written.
- No dependencies added, nothing blocked.

## Review (written by Claude)

Approved (lead, 2026-10-06). New mobile `StateMessage` mirrors the web API (`onPress` action), block and inline sizes, alert role on errors, action label inside `<Text>`; shown in the dev catalog and covered by kit tests. Pre-review clean (0 findings). Screen adoption comes in later tasks.
