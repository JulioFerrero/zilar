---
id: T-0246
title: "Web kit batch 2: SegmentedControl, ListRow, Card with SectionLabel, StateMessage, Avatar fixture, Cosmos config fixes"
status: merged
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

### Fix round (lead): playground on 5100, renderer port explicit
- The original config set the playground to 5050, which collides with the Vite
  renderer's default (5050): the iframe loaded the playground itself and every
  fixture stayed on "WAITING FOR RENDERER...". Fixed by separating the ports.
- `apps/web/cosmos.config.json` now:
  `"port": 5100` (playground), `"host": "localhost"`, `"vite": { "port": 5150 }`
  (renderer), `plugins` + `exportPath` unchanged.
- Option names and sources:
  - `port` (top-level, playground dev server, default 5000) and `host`
    (top-level, default `null` = bind every interface):
    https://reactcosmos.org/docs/configuration/cosmos-config
  - `vite.port` (renderer port, default 5050):
    https://reactcosmos.org/docs/getting-started/vite/ . The plugin package ships
    no README, so I also confirmed it in the installed source:
    `getCosmosVitePort` in `react-cosmos-plugin-vite/dist/createCosmosViteConfig.js`
    destructures `{ port = 5050 }` from the `vite` config.
- Verified for real (server started with `pnpm --filter @zilar/web cosmos`, then
  stopped; no listeners left on 5100/5150):
  - `curl -s http://localhost:5100/ | grep -oE '<title>[^<]*</title>|<script[^>]*src="[^"]*"'`
    → `<title>React Cosmos</title>` and `<script src="playground.bundle.js"`, HTTP 200.
  - `curl -s http://localhost:5150/ | grep -oE '<title>[^<]*</title>|<script[^>]*src="[^"]*"'`
    → `<title>Zilar</title>` and `<script type="module" src="/src/main.tsx"`, HTTP 200.
    `http://localhost:5150/renderer.html` also answers 200.
  - The renderer does NOT return the playground HTML: no `playground.bundle.js`,
    it is the app `index.html` with Cosmos' renderer entry.
  - Cosmos startup log: `[Cosmos] See you at http://localhost:5100`.
- Note: the Vite plugin hardcodes `server.host: '0.0.0.0'` for the renderer
  (`viteDevServerPlugin.js:23`), so the renderer binds every interface even
  though `host: "localhost"` constrains the playground. This is plugin behaviour,
  not our config.

### What I did originally
- **Cosmos config**: `apps/web/cosmos.config.json` now has `"port": 5100` and
  `"host": "localhost"` for the playground, plus `"vite": { "port": 5150 }` for the
  renderer (see the fix round above). `exportPath` unchanged.
- **Decorator**: `apps/web/src/cosmos.decorator.tsx` frame now has `min-h-dvh`.
- **New pieces** in `apps/web/src/components/ui/`, each with a fixture:
  - `segmented-control.tsx`: `SegmentedControl({ options, value, onChange, ariaLabel })`.
    Well track + `segment-raised` active segment; `role="tablist"` / `role="tab"` /
    `aria-selected`; ArrowLeft/ArrowRight/Home/End move and select; the count uses
    the kit `Badge`, muted when the tab is not active.
  - `list-row.tsx`: `ListRow({ icon, title, subtitle, trailing, chevron, onClick, href, danger })`.
    32 px `key-icon` tile, title, one-line muted subtitle, lucide `ChevronRight`;
    `button` for `onClick`, router `Link` for `href`, `div` otherwise; hover
    `bg-surface-raised`; `danger` turns the title red.
  - `card.tsx`: `Card` (`bg-surface rounded-xl border border-border`, direct children
    separated by `divide-y divide-border`) and `SectionLabel` (uppercase 11/600,
    `tracking-[0.06em]`, muted).
  - `state-message.tsx`: `StateMessage({ kind, title, hint, action })`. `loading`
    has `role="status"` + spinner; `error` has `role="alert"` + danger lucide icon;
    `empty` has a muted lucide icon; the action is a kit `Button`.
- **Avatar fixture**: `apps/web/src/components/Avatar.fixture.tsx` (person, AI,
  online, image from a `data:` SVG, sizes 32/44/54). `fixtures.test.tsx` now globs
  `['./*.fixture.tsx', '../*.fixture.tsx']` and the minimum count was raised 7 → 12
  (11 ui + 1 Avatar).
- **Tests**: added `SegmentedControl`, `ListRow`, `Card`/`SectionLabel` and
  `StateMessage` cases to `kit.test.tsx`.

### Files changed
- `apps/web/cosmos.config.json` (M)
- `apps/web/src/cosmos.decorator.tsx` (M)
- `apps/web/src/components/ui/fixtures.test.tsx` (M)
- `apps/web/src/components/ui/kit.test.tsx` (M)
- `apps/web/src/components/ui/segmented-control.tsx` (new)
- `apps/web/src/components/ui/segmented-control.fixture.tsx` (new)
- `apps/web/src/components/ui/list-row.tsx` (new)
- `apps/web/src/components/ui/list-row.fixture.tsx` (new)
- `apps/web/src/components/ui/card.tsx` (new)
- `apps/web/src/components/ui/card.fixture.tsx` (new)
- `apps/web/src/components/ui/state-message.tsx` (new)
- `apps/web/src/components/ui/state-message.fixture.tsx` (new)
- `apps/web/src/components/Avatar.fixture.tsx` (new)
- `work/T-0246-web-kit-2.md` (M)

### Commands and real results
- `pnpm install`: done, exit 0 (peer warning only: `@types/react-dom` vs `@types/react` in mobile).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/ui`: **2 files passed, 84 tests passed**.
- `pnpm --filter @zilar/web cosmos`: started, `[Cosmos] See you at http://localhost:5100`; stopped after the curls (no listeners left on 5100/5150).
- `curl ... http://localhost:5100/` → HTTP 200, `<title>React Cosmos</title>`, `playground.bundle.js`.
- `curl ... http://localhost:5150/` → HTTP 200, `<title>Zilar</title>`, `/src/main.tsx` (renderer, not the playground).
- `pnpm --filter @zilar/web cosmos-export`: **Export complete**, `✓ 2162 modules transformed`, `✓ built in 651ms`, exit 0.
- `pnpm gate` (final, after the fix round): **GATE PASS**. Summary lines:
  ```
  gate: 14 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (21.1s)
  PASS  lint  (0.8s)
  PASS  typecheck  (10.7s)
  PASS  tests @zilar/web  (6.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  (First gate run failed only on format for 5 new files; I ran
  `pnpm exec prettier --write` on exactly those 5 files and re-ran gate.)

### Deviations / notes
- `Card` also gets `overflow-hidden` so the first/last row clips to the rounded
  corner; not spelled out in the spec.
- `ListRow` applies `hover:bg-surface-raised` only when it is interactive
  (`onClick` or `href`); a static `div` row does not highlight.
- If both `onClick` and `href` are passed, `href` wins (spec does not define a
  precedence).
- I did not open the Cosmos UI in a browser; the port split and localhost binding
  were verified with `curl` (see the fix round above) plus a successful
  `cosmos-export`.
- No new dependency. No screen changes. Icons are lucide only, no emoji.

### Blocked / needs a decision
None.

## Review (written by Claude)

**Verdict:** Approved after one lead fix round, which fixed the Cosmos port collision: 5050 had been the Vite renderer's default. The pre-review of `a12dac1d` was clean.
- I checked in the browser: the playground on 5100 renders the ListRow (WithChevron), SegmentedControl (WithCounts) and Card (GroupedRows with a SectionLabel) fixtures. The first load takes a few seconds while Vite builds.
- All icons are lucide, and no screen changed.
