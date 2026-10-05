---
id: T-0243
title: "Web: React Cosmos catalog, fixtures for the kit, and the first new kit pieces (Dialog, TextInput, Badge, Switch)"
status: planned
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

## Review (written by Claude)
