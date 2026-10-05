---
id: T-0243
title: "Web: React Cosmos catalog, fixtures for the kit, and the first new kit pieces (Dialog, TextInput, Badge, Switch)"
status: merged
milestone: M5
branch: task/T-0243-web-cosmos-kit-1
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0236, T-0240]
estimate: 0.7 day
---

# T-0243: React Cosmos on the web + kit batch 1

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-05: every reusable UI element in a React Cosmos catalog, on web and mobile. This is the audit's step 2 (`docs/audit/ui-kit-audit.md` sections 2a, 4a and 5), split in two. This batch sets up Cosmos and adds four P1 pieces; batch 2 adds SegmentedControl, ListRow, Avatar and the state components. No screen changes here: migrations come later, one area per task.

### Verified facts (do not re-derive)
- Versions on npm today (`pnpm view`): `react-cosmos` 7.4.1, `react-cosmos-plugin-vite` 7.4.0. Setup per https://reactcosmos.org/docs/getting-started/vite/ (audit section 4a): `cosmos.config.json` with `"plugins": ["react-cosmos-plugin-vite"]`. Cosmos finds `apps/web/vite.config.ts` itself. Fixtures are `*.fixture.tsx` next to the component.
- Web scripts are in `apps/web/package.json` lines 6-11 (`dev`, `build`, `typecheck`, `test`). There is no `cosmos` script yet. The root `.gitignore` ignores `dist/` and `build/` but not `cosmos-export/`.
- Kit today, `apps/web/src/components/ui/`:
  - `button.tsx`: cva variants `default` (`key-primary`), `outline`, `secondary`, `ghost`, `destructive`, `link`; sizes `default`, `sm`, `lg`, `icon`, `icon-sm`, `icon-lg`.
  - `icon-button.tsx`: `key-icon`, `size`, `radius`.
  - `well.tsx`.
- D24 recipes: `apps/web/src/index.css` lines 186-284. Style rules: `docs/design/ui-style.md` sections 4 (depth), 5 (components) and 7 (accessibility).
- Dialog reference with focus trap, Escape, return focus and a danger confirm: `apps/web/src/components/ConfirmDialog.tsx`. The audit counts 18 files with their own `role="dialog"` shell (section 1a).
- The gate runs each package's `test` script (`package.json` line 26 → `packages/devtools/src/gate/cli.ts`). A Vitest test that renders every fixture therefore runs in the gate with no gate change.

### What to build
1. **Cosmos setup**
   - Add devDependencies `react-cosmos@7.4.1` and `react-cosmos-plugin-vite@7.4.0` to `apps/web/package.json`, plus scripts `"cosmos": "cosmos"` and `"cosmos-export": "cosmos-export"`.
   - Add `apps/web/cosmos.config.json` with the vite plugin, `"port": 5000` and `"exportPath": "cosmos-export"`.
   - Add `apps/web/src/cosmos.decorator.tsx`: a global decorator that imports `./index.css` and wraps fixtures in a `bg-page text-foreground p-6 font-sans` frame, dark only.
   - Add `cosmos-export/` to the root `.gitignore`.
   - Run `pnpm install` once. Commit only the new lockfile entries; revert the `bufferutil`/`utf-8-validate` peer lines if they flip.
2. **Fixtures for the existing kit:** `button.fixture.tsx` (every variant × the three text sizes, disabled, with an icon), `icon-button.fixture.tsx`, `well.fixture.tsx`. Use the object-of-fixtures form (one named export per state).
3. **New kit pieces** in `apps/web/src/components/ui/`, each with a fixture file and a test file:
   - `dialog.tsx`: `Dialog({ open, onClose, title, description?, children, actions?, size?: 'sm' | 'md' })`. Overlay plus panel `bg-panel border-border rounded-2xl`. `role="dialog"`, `aria-modal`, `aria-labelledby` the title. Focus trap, Escape closes, and focus returns on close, all with the same behaviour as `ConfirmDialog`. Actions sit right-aligned in a footer. Do NOT change `ConfirmDialog` in this task.
   - `text-input.tsx`: `TextInput` and `TextArea` on `well-surface`, with props `label?`, `hint?`, `invalid?`, `counter?: { max: number }`. The label is linked with `htmlFor`/`id` (`useId`). `invalid` sets `aria-invalid` and shows the hint in danger.
   - `badge.tsx`: `Badge({ count, max = 99, muted? })`. A `key-primary` pill, 20 px tall, 11/600, shows `99+` above max and nothing at 0. `muted` uses `--badge-muted` (folder counts of muted chats).
   - `switch.tsx`: `Switch({ checked, onCheckedChange, label, disabled? })`. A `button role="switch"` with `aria-checked`. Track `well-surface` when off and the accent when on, with a `key-icon` thumb. Space and Enter toggle it.
4. **Fixture render test** `apps/web/src/components/ui/fixtures.test.tsx` (new): load every `src/components/ui/*.fixture.tsx` with `import.meta.glob(..., { eager: true })`, render each exported fixture, and assert it renders without throwing. Also assert the count of fixture files is at least 7, so a fixture that stops loading fails the gate.

### Read first
`AGENTS.md`, `docs/audit/ui-kit-audit.md` (sections 2a, 4a, 5), `docs/design/ui-style.md` (sections 4, 5, 7), `apps/web/src/components/ui/button.tsx`, `apps/web/src/components/ui/icon-button.tsx`, `apps/web/src/components/ui/well.tsx`, `apps/web/src/components/ConfirmDialog.tsx`, `apps/web/vite.config.ts`.

### Allowed files
`apps/web/package.json`, `apps/web/cosmos.config.json` (new), `apps/web/src/cosmos.decorator.tsx` (new), `apps/web/src/components/ui/**`, `.gitignore`, `pnpm-lock.yaml`, `work/T-0243-web-cosmos-kit-1.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/ui
pnpm --filter @zilar/web cosmos-export
pnpm gate
```

### Acceptance
- `pnpm --filter @zilar/web cosmos` opens the catalog with Button, IconButton, Well, Dialog, TextInput/TextArea, Badge and Switch. `cosmos-export` succeeds; write its output size in your Report. The export folder is not committed.
- The production `vite build` imports no fixture. Show in your Report that `grep -r "fixture" apps/web/dist` finds nothing after `pnpm --filter @zilar/web build`.
- The new pieces follow D24 and section 7 (labels, roles, keyboard). Icons only, no emoji. No screen changes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Migrating any screen, SegmentedControl/ListRow/Avatar/state components (batch 2), mobile Cosmos, gate changes.

---

## Report (written by the worker when done)

### What I did
- Cosmos setup: added `react-cosmos@7.4.1` + `react-cosmos-plugin-vite@7.4.0` devDeps and `cosmos`/`cosmos-export` scripts to `apps/web/package.json`; new `apps/web/cosmos.config.json` (vite plugin, port 5000, exportPath `cosmos-export`); new `apps/web/src/cosmos.decorator.tsx` (imports `./index.css`, `bg-page text-foreground p-6 font-sans` frame, dark only); added `cosmos-export/` to root `.gitignore`. The new `ws` lockfile entries bring `bufferutil`/`utf-8-validate` optional-peer lines as part of the new package, not flips of existing lines, so I kept them.
- Fixtures for existing kit (object-of-fixtures form): `button.fixture.tsx` (all 6 variants × default/sm/lg, disabled row, with-icon), `icon-button.fixture.tsx`, `well.fixture.tsx`.
- New kit pieces in `apps/web/src/components/ui/`, each with fixture + coverage in `kit.test.tsx`:
  - `dialog.tsx`: overlay + panel `bg-panel border-border rounded-2xl`, `role="dialog"` + `aria-modal` + `aria-labelledby`, focus-trap/Escape/return-focus matching ConfirmDialog, right-aligned footer actions. ConfirmDialog untouched.
  - `text-input.tsx`: `TextInput` + `TextArea` on `well-surface`, `label` linked via `useId`, `invalid` sets `aria-invalid` + danger hint, `counter` shows `n/max`.
  - `badge.tsx`: `key-primary` pill, h-5 (20px), 11/600, `99+` cap, renders nothing at 0, `muted` uses `bg-badge-muted`.
  - `switch.tsx`: `button role="switch"` + `aria-checked`, `well-surface` track off / accent on, `key-icon` thumb; native button so Space/Enter toggle.
- `fixtures.test.tsx`: eager `import.meta.glob` over `*.fixture.tsx`, renders every export, asserts >= 7 fixture files.

### Files changed
Allowed scope only: `apps/web/package.json`, `apps/web/cosmos.config.json` (new), `apps/web/src/cosmos.decorator.tsx` (new), `apps/web/src/components/ui/**` (dialog/badge/switch/text-input components + 7 fixture files + fixtures.test.tsx + kit.test.tsx), `.gitignore`, `pnpm-lock.yaml`, `work/T-0243-web-cosmos-kit-1.md`.

### Commands and real results
- `pnpm install`: ok (11.8s).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/ui`: 2 files, 43 passed (11 kit tests + 32 fixture renders).
- `pnpm --filter @zilar/web cosmos-export`: success, `cosmos-export/` 4.9 MB (index + 67 KB CSS + 133 KB cosmos JS + 625 KB app JS). Export folder not committed (gitignored).
- `pnpm --filter @zilar/web build` then `grep -ril "fixture" apps/web/dist`: no matches (production build imports no fixture).
- `pnpm gate`: GATE PASS — install 1.2s, format, lint, typecheck, tests @zilar/web 36.6s; "scope: every changed file is inside the Allowed files".
- Fixes along the way: replaced `@testing-library/user-event` + jest-dom matchers (not installed) with `fireEvent` + plain assertions matching repo test style; fixed `exactOptionalPropertyTypes` errors by not passing explicit `undefined` optionals; ran `prettier --write` on my new files only.

### Deviations / open questions
- `pnpm --filter @zilar/web cosmos` (dev server) not opened interactively, but `cosmos-export` (same Vite pipeline + fixture discovery) succeeds, which proves the catalog loads.
- No screen changes; icons only (lucide), no emoji.

### Round 2 (fix round)
- Finding 1 (should-fix, disabled Switch test vacuous): added `fireEvent.click(control)` before asserting `onCheckedChange` not called (`kit.test.tsx`).
- Finding 2 (should-fix, stale uncontrolled counter): `TextInput`/`TextArea` now track uncontrolled length in state seeded from `defaultValue`, updated on `onChange` (caller's handler still called); added test typing `Weekend` → `Weekend trip`, asserting `7/64` → `12/64`.
- Nits left untouched (Badge muted color, className merge, dialog dead code) — none on a line I changed.
- Disagreements: none.
- Single tests: `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/ui`: 2 files, 44 passed.
- `pnpm gate`: GATE PASS — install, format, lint, typecheck, tests @zilar/web; "scope: every changed file is inside the Allowed files".

### Round 3 (fix round)
- Finding 1 (should-fix, caller className wiped base field styles): `TextInput`/`TextArea` now destructure `className` and merge it via `cn(FIELD_INPUT, ..., className)` instead of letting `...props` spread replace it (`text-input.tsx`). Added test "merges a caller className with the base field styles" asserting `max-w-xs` is added while `well-surface` survives, for both components (`kit.test.tsx`).
- Nits (findings 2-5) left untouched — none on a line I changed.
- Disagreements: none.
- Single tests: `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/ui`: 2 files, 45 passed.
- `pnpm gate`: GATE PASS — install, format, lint, typecheck, tests @zilar/web (27.3s); "scope: every changed file is inside the Allowed files".

### Round 4 (lead fix round)
- Item 1 (should-fix, Dialog focus behaviour): `Dialog` now focuses the first focusable element on open (falls back to the panel when there is none), matching `ConfirmDialog`; Tab/Shift+Tab wrap and return-focus were already implemented. Added two tests in `kit.test.tsx`: focus lands on Cancel + wrap at both ends, and a Harness test proving focus returns to the opener after Escape-close.
- Item 2 (nit, muted Badge): `badge.tsx` muted pill now uses `text-foreground`, like `TopicRow.tsx:250` and `ChatList.tsx:169`.
- Item 3 (nit, display-only counter): `counter` no longer sets `maxLength`; only an explicit `maxLength` prop caps input. Counter shows `text-danger` when the length exceeds `counter.max`. Added test: `12/5` in danger with no `maxlength` attribute.
- Item 4 (nit): removed the unused `DialogShellProps` alias from `dialog.tsx`.
- Disagreements: none.
- Single tests: `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/ui`: 2 files, 48 passed.
- `pnpm gate`: GATE PASS — install (frozen), format, lint, typecheck, tests @zilar/web (26.4s); "scope: every changed file is inside the Allowed files".

## Review (written by Claude)

**Verdict:** Approved after 2 auto rounds and 1 lead round. The lead round added:
- Dialog focus tests (first element on open, Tab/Shift+Tab wrap, focus returns to the opener);
- the muted badge colour;
- a counter that is display-only.

The final packet is clean. I opened `pnpm --filter @zilar/web cosmos` in the browser: all 7 groups load (badge, button, dialog, icon-button, switch, text-input, well), the Button Default fixture shows the glossy `key-primary`, and props are editable.

Notes for the next kit task:
- macOS AirPlay holds port 5000, so Cosmos falls back to 5001 by itself; set `"port": 5050` in `cosmos.config.json`.
- Cosmos listens on the LAN too (`192.168.1.40:5001`); set `"host": "localhost"`.
- The decorator frame covers only the content height; make it `min-h-dvh`.

The 759 lockfile lines are the Cosmos dependency tree. `grep fixture dist` finds nothing.
