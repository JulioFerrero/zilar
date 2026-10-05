---
id: T-0246
title: "Web kit batch 2: SegmentedControl, ListRow, Card with SectionLabel, StateMessage, Avatar fixture, Cosmos config fixes"
status: planned
milestone: M5
branch: task/T-0246-web-kit-2
model: deepseek/deepseek-flash
effort: default
depends_on: [T-0243]
estimate: 0.5 day
---

# T-0246: Web kit batch 2

## Spec (written by Claude, do not edit)

### Why
UI kit step 2, second half (`docs/audit/ui-kit-audit.md` sections 2a and 5; Julio wants every reusable element in React Cosmos). Batch 1 (T-0243) is merged. This batch adds the remaining P1 pieces and fixes three Cosmos setup issues the lead found when opening the catalog. No screen changes; migrations come later, one area per task.

### Verified facts (do not re-derive)
- Kit folder `apps/web/src/components/ui/`:
  - pieces: `badge`, `button`, `dialog`, `icon-button`, `switch`, `text-input`, `well`, each with a `*.fixture.tsx`;
  - `fixtures.test.tsx` renders every fixture;
  - `kit.test.tsx` holds the behaviour tests.
  Follow their style (named fixture exports, `cn`, D24 utilities).
- `apps/web/cosmos.config.json`: `"port": 5000`. macOS AirPlay listens on 5000, so Cosmos falls back to 5001. It also binds every interface (it printed `192.168.1.40:5001`).
- `apps/web/src/cosmos.decorator.tsx`: the frame is `bg-page p-6 font-sans text-foreground` and covers only the content height.
- Segmented track today: `apps/web/src/components/FolderTabs.tsx` (well track + `segment-raised` active) and `apps/web/src/components/ais/ModelPicker.tsx`. Recipe in `apps/web/src/index.css` (`segment-raised`, `well-surface`).
- Rows today: `apps/web/src/components/SettingsShell.tsx` (`SETTINGS_COLUMN` at line 62) and the settings pages. Mockup: `docs/design/briefs/telegram-nav-folders-settings.html` v3 (rows: `key-icon` tile, title, muted subtitle, chevron; grouped cards with hairline dividers; uppercase muted section labels 11/600).
- `apps/web/src/components/Avatar.tsx` (`Avatar` at line 47, props `id, name, size, online, ai, avatarUrl`) already is the shared avatar. It gets a fixture only; do not move it.
- `apps/web/src/components/EmptyState.tsx` is app-specific (variants `no-chats`, `no-chat-selected`). Keep it. The kit piece gets a different name, `StateMessage`.

### What to build
1. **Cosmos config:**
   - `"port": 5050` and `"host": "localhost"` in `cosmos.config.json` (check the option names on reactcosmos.org config docs; write what you used in your Report);
   - the decorator frame gets `min-h-dvh`.
2. **New pieces** in `apps/web/src/components/ui/`, each with a fixture file and tests added to `kit.test.tsx`:
   - `segmented-control.tsx`: `SegmentedControl({ options: { value, label, count? }[], value, onChange, ariaLabel })`.
     - Well track and `segment-raised` active segment.
     - `role="tablist"` with `role="tab"` buttons and `aria-selected`.
     - ArrowLeft/ArrowRight/Home/End move and select.
     - The count shows with the kit `Badge` (muted when not active).
   - `list-row.tsx`: `ListRow({ icon?, title, subtitle?, trailing?, chevron?, onClick?, href?, danger? })`.
     - The icon sits in a 32 px `key-icon` tile; then the title, a one-line muted subtitle and a lucide `ChevronRight` when `chevron`.
     - A `button` when `onClick`, a router `Link` when `href`, a `div` otherwise.
     - Hover `bg-surface-raised`; `danger` turns the title red.
   - `card.tsx`: `Card({ children, className? })` (`bg-surface rounded-xl border border-border`; direct `ListRow` children get hairline dividers via `divide-y divide-border`), and `SectionLabel({ children })` (uppercase, 11/600, letter-spacing 0.06em, muted).
   - `state-message.tsx`: `StateMessage({ kind: 'empty' | 'loading' | 'error', title, hint?, action?: { label, onClick } })`.
     - `loading` shows a spinner with `role="status"`; `error` uses `role="alert"`; `empty` uses a muted lucide icon.
     - The action is a kit `Button`.
3. **Avatar fixture** `apps/web/src/components/Avatar.fixture.tsx`: person, AI, online, with an image (use a `data:` SVG, no network), and sizes 32/44/54. Extend `fixtures.test.tsx` to also load `src/components/*.fixture.tsx`, and raise its minimum count.

### Read first
`AGENTS.md`, `docs/audit/ui-kit-audit.md` (section 2a), `apps/web/src/components/ui/badge.tsx`, `apps/web/src/components/ui/switch.tsx`, `apps/web/src/components/ui/fixtures.test.tsx`, `apps/web/src/components/FolderTabs.tsx`, `apps/web/src/components/Avatar.tsx`, `docs/design/ui-style.md` (sections 4, 5, 7).

### Allowed files
`apps/web/src/components/ui/**`, `apps/web/src/components/Avatar.fixture.tsx` (new), `apps/web/cosmos.config.json`, `apps/web/src/cosmos.decorator.tsx`, `work/T-0246-web-kit-2.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/ui
pnpm --filter @zilar/web cosmos-export
pnpm gate
```

### Acceptance
- The catalog shows the new pieces and the Avatar on `localhost:5050` only.
- Keyboard and roles follow `ui-style.md` section 7. Icons only, no emoji. No screen changes and no new dependency.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Migrating screens, Menu/Popover, PageHeader, mobile kit.

---

## Report (written by the worker when done)

## Review (written by Claude)
