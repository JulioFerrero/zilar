# UI kit audit (T-0236)

Docs-only audit. No code, config or package changes. Every count below comes from
`rg` over the repo at `/Users/julio/personal-projects/zilar-T-0236` on 2026-10-05;
the exact command is given per section. Test files (`*.test.*`) are excluded from
all counts. "Files" means files containing at least one match; "occ" means total
match occurrences.

## 0. Starting point (verified facts)

- Web kit `apps/web/src/components/ui/`: `button.tsx` (cva variants, `default` =
  `key-primary`), `icon-button.tsx`, `well.tsx`.
- Mobile kit `apps/mobile/src/components/ui/`: `button.tsx` (glossy primary key
  via `primaryKey` style from `lib/depth.ts`), `icon-button.tsx`, `text.tsx`,
  `use-key-press.ts`.
- Depth recipes: web utilities in `apps/web/src/index.css` lines 186-284
  (`key-primary`, `key-icon`, `well-surface`, `raised-pill`, `segment-raised`,
  `reaction-chip`); mobile plain-data styles in `apps/mobile/src/lib/depth.ts`
  (`primaryKey`, `iconKey`, `well` at line 80, `segment`, `raisedPill`,
  `bubbleStyle()`, `avatarShade()`).
- Tokens live twice: `apps/web/src/index.css` `:root` lines 66-134 and
  `apps/mobile/src/global.css` `:root` lines 12-60 (plus literal colors in
  `apps/mobile/src/lib/colors.ts` and `apps/mobile/src/lib/depth.ts`). No shared
  UI or token package: `packages/` holds only agent-drivers, chat-core, devtools,
  protocol, runner-tunnel, xmpp-core (`ls packages/`).
- Versions (`apps/web/package.json` lines 23/42, `apps/mobile/package.json`
  lines 26/46-50): web React `^19.3.0` + Vite `^8.3.1`; mobile Expo `~57.0.25`,
  React Native `0.86.3`, React `19.2.3`, nativewind `4.2.7`,
  `react-native-web ~0.21.0` already present (line 57). Mobile has a hidden dev
  route folder `apps/mobile/src/app/dev/` (currently only `whistle.tsx`).
- Design spec: `docs/design/ui-style.md` (D24).

## 1. Inventory

### 1a. Web (`apps/web/src`)

**Buttons.** Kit `Button` (`./ui/button` or `@/…`): 13 files. Raw `<button`:
67 files, 249 occurrences.

```
rg -l --glob '!**/*.test.*' 'ui/button' apps/web/src | wc -l  # 13 (relative ./ui/button plus @/ alias/barrel imports)
rg --glob '!**/*.test.*' -o '<button' apps/web/src | wc -l  # 249 (67 files)
```

Hand-rolled accent buttons (`bg-accent`): 32 files. The dominant shape is a flat
`rounded-full bg-accent px-4 py-1.5 text-accent-foreground hover:bg-accent/90` —
it uses the accent color but NOT the `key-primary` depth recipe (no gloss, no
key shadow, no press translation). Only 8 files use `key-primary` at all.
Examples:

- `apps/web/src/components/ExplorePage.tsx:253` (`rounded-full bg-accent px-4 py-1.5 …`)
- `apps/web/src/components/ExplorePage.tsx:282` (same shape)
- `apps/web/src/routes/NamePage.tsx:68` (`mt-4 w-full rounded-full bg-accent px-4 py-2.5 …`)
- `apps/web/src/components/InviteDialog.tsx:96` (same shape)
- `apps/web/src/components/ProfileSettingsSection.tsx:164` (`rounded-full bg-accent px-4 py-1.5 …`)
- `apps/web/src/components/ContactProfileRow.tsx:152-158` (accent button with raw classes, per lead)

**Icon buttons.** Kit `IconButton` (`components/ui/icon-button`): 4 files
(`ChatHeader.tsx:9`, `ChatList.tsx:22`, `Composer.tsx:30`,
`MessageList.tsx:14`); `key-icon` utility: 5 files (includes `index.css`
itself and the kit's own `ui/icon-button.tsx`, so 3 consumer files:
`MessageActionsMenu`, `VoiceMessage`, `FileMessage`).
Most icon keys are still hand-rolled raw `<button>`s.

**Text inputs and wells.** `<input` or `<textarea`: 30 files. `well-surface`
utility: 12 files (includes `index.css` itself). Examples:

- `apps/web/src/components/NewTopicDialog.tsx:218` (`well-surface rounded-[10px] px-3 py-2 …`)
- `apps/web/src/components/NewTopicDialog.tsx:212,295,331,359` (raw `<input>`)
- `apps/web/src/components/PackEditor.tsx:420,433` (raw `<input>`)
- `apps/web/src/components/UnreadDivider.tsx:7` (`well-surface` unread strip)
- `apps/web/src/components/tools/CodeBlock.tsx:14,51` (`well-surface` code block)

There is no shared `TextInput`/`TextArea` component; each dialog styles its own.

**Dialogs and modals.** `role="dialog"`: 18 files. Examples:

- `apps/web/src/components/ConfirmDialog.tsx:69`
- `apps/web/src/routes/GroupHandleRoute.tsx:108,199`
- `apps/web/src/components/NewChatButton.tsx:267,298`
- `apps/web/src/components/StickerPanel.tsx:353`

There is no shared `Dialog` shell; each builds its own overlay + panel. (A shared
shell would also be the place to centralize focus trap / `Esc` handling per
ui-style.md §7.)

**Bottom sheets.** No bottom-sheet abstraction found on web (mobile-only pattern).

**List rows.** `ChevronRight`/chevron on web: 1 file
(`apps/web/src/components/TopicRow.tsx:203`). Settings-type rows are built ad hoc
per page, e.g. `apps/web/src/components/SettingsShell.tsx`,
`apps/web/src/routes/NotificationsPage.tsx`,
`apps/web/src/components/ProfileSettingsSection.tsx:162-171` (save button +
raw rows). No shared `ListRow`/`SettingsRow` component.

**Cards.** No shared `Card` component; panels use raw `rounded-* border-border
bg-panel` classes (e.g. the two floating panels per ui-style.md §1). Not counted
separately because the shape varies; the kit proposal below covers it.

**Toggles / switches / checkboxes.** `role="switch"` / `<Switch` / `<Checkbox` /
`type="checkbox"`: 5 files. No shared `Switch` or `Checkbox` component.

**Segmented controls and tabs.** `segment-raised`: 3 files; `role="tab"`/`Tabs`:
3 files. Examples:

- `apps/web/src/components/NewTopicDialog.tsx:253` (`well-surface … p-[3px]` track)
- `apps/web/src/components/ExplorePage.tsx:182` (`border-accent bg-accent/10` selected-tab shape)

No shared `SegmentedControl`/`Tabs` component; folder tabs and dialog-internal
tabs each roll their own.

**Badges and counts.** `Badge|unread.*count|badge` (case-sensitive `Badge` plus
lowercase): 27 files. The unread badge should be a primary-key pill per
ui-style.md §5 but most are flat pills. `reaction-chip` utility exists in
`index.css` (line 288) with 4 files referencing `Chip|reaction-chip`.

**Avatars.** `<Avatar|AvatarUploader`: 21 files. Two implementations:
`apps/web/src/components/Avatar.tsx` and
`apps/web/src/components/AvatarUploader.tsx`. Callers re-implement size/ring
choices per site.

**Chips.** `Chip|reaction-chip`: 4 files (reaction chips + filter chips in
`ExplorePage`).

**Menus / popovers.** `Popover|DropdownMenu|ContextMenu|<select`: 5 files. No
shared `Menu`/`Popover` wrapper; examples include `NewChatButton.tsx:267,298`
(dialog-styled menu).

**Empty, loading, error states.** Case-insensitive
`empty|no messages|no results|loading|skeleton|something went wrong|try again`:
76 files. No shared `EmptyState`/`LoadingState`/`ErrorState` components; each
screen hand-rolls centered muted text, spinners and retry buttons.

**Section labels.** `SectionLabel|section-label|text-xs.*uppercase|uppercase.*text-xs`:
0 files on web — section labels are unstyled ad-hoc muted text, so a kit
`SectionLabel` would standardize rather than replace.

**Page headers with back.** `BackButton|goBack|arrow-left|ArrowLeft`: 4 files.
No shared `PageHeader`/`BackButton`; narrow-layout headers each roll their own.

### 1b. Mobile (`apps/mobile/src`)

**Buttons.** Kit import (`components/ui/button`): 13 files. Raw `<Pressable`:
75 files, 342 occurrences.

```
rg -l --glob '!**/*.test.*' 'components/ui/button' apps/mobile/src | wc -l  # 13
rg --glob '!**/*.test.*' -o '<Pressable' apps/mobile/src | wc -l  # 342 (75 files)
```

`ui/icon-button` import: 12 files. Examples of raw pressables:

- `apps/mobile/src/components/chat/chat-list-item.tsx:65`
- `apps/mobile/src/app/explore.tsx:219,253,288,309`
- `apps/mobile/src/components/ais/tool-detail-sheet.tsx:120,161,184`

**Text inputs and wells.** `<TextInput`: 32 files. `lib/depth` import (any
recipe): 31 files. No shared `TextInput` wrapper; wells use the `well` style
object ad hoc.

**Dialogs and modals.** `Modal|BottomSheet`: 24 files. Examples:

- `apps/mobile/src/app/settings/integrations.tsx:278` (`Modal visible transparent animationType="fade"`)
- `apps/mobile/src/app/settings/machines.tsx:488,614`
- `apps/mobile/src/components/ais/tool-detail-sheet.tsx:497`
- `apps/mobile/src/components/stickers/telegram-import-sheet.tsx:123` (`animationType="slide"`)
- `apps/mobile/src/components/approvals/always-allowed-row.tsx:81`

No shared `Dialog`/`Sheet` shell; animation type, backdrop and padding differ per site.

**List rows.** `ChevronRight`: settings index + AI rows, e.g.:

- `apps/mobile/src/app/settings/index.tsx:97` (`ChevronRight size={18}`)
- `apps/mobile/src/components/ais/ai-row.tsx:61` (`ChevronRight size={20}`)

No shared `ListRow`; chevron size/color are chosen per site.

**Toggles / switches.** `<Switch`: 0 files. Case-insensitive `switch|toggle`
matches are all store/domain logic (`real-store.ts`, `chat-store.ts`,
`connection.ts`, `routines-format.ts`), not UI. Toggles are hand-rolled
`Pressable`s, e.g. `apps/mobile/src/app/settings/integrations.tsx:200`
(`onPress={onToggleShow}` with `onToggleShow: () => void`, lines 161-172). No
shared `Toggle`/`Switch` component — highest-value mobile gap after buttons.

**Segmented controls and tabs.** Case-insensitive `segment|tab-bar|tabs`:
14 files, including `apps/mobile/src/components/chat/folder-tabs.tsx`. No shared
`SegmentedControl`; the folder tabs and other tab bars each roll their own
against `segment`/`well` styles.

**Badges and counts.** Case-insensitive `badge|unread`: 26 files. No shared
`Badge`; unread pills re-implement the primary-key look per site.

**Avatars.** Case-insensitive `avatar`: 35 files. Two implementations:
`apps/mobile/src/components/chat/avatar.tsx` (uses `avatarShade(id, ai)` from
`lib/depth.ts:179`) and
`apps/mobile/src/components/settings/avatar-control.tsx`. Plus
`apps/mobile/src/components/settings/avatar-native.ts` (+ test).

**Chips.** Case-insensitive `chip`: 18 files. No shared `Chip`.

**Menus / popovers.** No popover abstraction found; action sheets are `Modal`s
(see dialogs). `chat-actions-sheet.tsx`, `attach-sheet.tsx`, `emoji-sheet.tsx`
exist per feature, not as a shared `ActionSheet`.

**Empty, loading, error states.** Case-insensitive
`empty|skeleton|loading|error-state|try again`: 111 files. No shared state
components.

**Section labels.** `SectionLabel|section` (case-sensitive): 23 files. Labels are
ad hoc; a shared `SectionLabel` standardizes rather than replaces.

**Page headers with back.** `Stack.Screen|headerBack|goBack|BackButton`: 1 file.
Headers are expo-router `Stack.Screen` options per screen plus
`apps/mobile/src/components/settings/screen-shell.tsx`; no shared header
component with back button.

## 2. Proposed kit

Same component names on web and mobile. Props sketches are platform-idiomatic
(React DOM props on web, React Native props on mobile) but the names match.
P1 = used in 5+ places (everything below is P1 except where marked P2).

### 2a. Web (`apps/web/src/components/ui/`)

| Component | Props API sketch | D24 recipe | Replaces (duplicates) | Priority |
|---|---|---|---|---|
| `Button` (exists, extend) | `variant: primary\|secondary\|outline\|ghost\|danger\|link`, `size: sm\|md\|lg\|icon`, existing `asChild` | `key-primary` for primary; plain + focus ring others | 32 files of `bg-accent` hand-rolls (§1a); adopters: `ExplorePage.tsx:253,282`, `NamePage.tsx:68`, `InviteDialog.tsx:80,96`, `ProfileSettingsSection.tsx:164` | P1 |
| `IconButton` (exists, extend) | `label: string`, `size: sm\|md\|lg`, `pressed?: boolean` | `key-icon` | raw `<button>` icon keys across ~60 files; `ContactProfileRow`, chat header keys | P1 |
| `TextInput` + `TextArea` (new) | `value, onChange, placeholder, invalid?: boolean, hint?: string` | `well-surface` | 30 files of raw `<input>/<textarea>`; `NewTopicDialog.tsx:212,295,331,359`, `PackEditor.tsx:420,433` | P1 |
| `Dialog` (new: overlay + shell + title + actions) | `open, onClose, title, children, actions` | panel `bg-panel border-border rounded-2xl`; primary/danger `Button` in actions | 18 `role="dialog"` files; `ConfirmDialog.tsx:69`, `GroupHandleRoute.tsx:108,199`, `NewChatButton.tsx:267,298`, `StickerPanel.tsx:353` | P1 |
| `SegmentedControl` (new) | `options: {value,label,count?}[], value, onChange` | well track + `segment-raised` active | `ExplorePage.tsx:182`, `NewTopicDialog.tsx:253`, folder tabs; 3+ tab implementations | P1 |
| `ListRow` (new: icon, title, subtitle, chevron, trailing) | `icon?, title, subtitle?, chevron?: boolean, trailing?, onPress` | `hover:bg-surface-raised rounded-xl` | `TopicRow.tsx`, `SettingsShell.tsx`, `NotificationsPage.tsx`, `ProfileSettingsSection.tsx` rows | P1 |
| `Badge` (new: unread count pill) | `count: number, max?: number` | `key-primary` pill, 20px, 11/600 | 27 badge files; chat list unread pills | P1 |
| `Avatar` (unify existing two) | `id, name, size: sm\|md\|lg, ai?: boolean, uri?` (+ uploader mode) | monochrome shades per §2 | `Avatar.tsx` + `AvatarUploader.tsx`; 21 caller files | P1 |
| `Switch` + `Checkbox` (new) | `checked, onChange, label` | accent key when on, well track when off | 5 switch/checkbox files; settings pages | P1 |
| `Menu`/`Popover` (new wrapper) | `trigger, items: {label,icon,danger?,onSelect}[]` | `bg-surface border-border` panel | 5 popover/menu files; `NewChatButton` menu | P2 (5 files, borderline) |
| `EmptyState` / `LoadingState` / `ErrorState` (new) | `title, hint?, action?: {label,onClick}` | `raised-pill` for empty-chat pill | 76 empty/loading/error files | P1 |
| `SectionLabel` (new) | `children` | muted 12/600 uppercase-ish per §2 | standardizes (0 current) | P2 |
| `PageHeader` with back (new) | `title, subtitle?, onBack?, trailing?` | 64px header, bottom border per §5 | 4 back-header files | P2 |
| `Card` (new) | `children, padded?: boolean` | `bg-panel border-border rounded-2xl` panels | floating panels, settings cards | P2 |

Notes: `Well` exists (`well.tsx`, imported by 5 files: `EditBar`, `FolderTabs`,
`SearchBar`, `AttachmentPreview`, `Composer`) — keep and reuse inside
`TextInput`/`Dialog`.
`reaction-chip` stays a utility; add a `Chip` component only if filter/reaction
call sites exceed 5 after migration (currently 4 → P2, not tabled).

### 2b. Mobile (`apps/mobile/src/components/ui/`)

| Component | Props API sketch | D24 recipe | Replaces (duplicates) | Priority |
|---|---|---|---|---|
| `Button` (exists, extend) | same variant/size names as web; `onPress` | `primaryKey` + `pressStyle` | 75 files / 342 raw `<Pressable>`; `chat-list-item.tsx:65`, `explore.tsx:219,253,288,309`, `tool-detail-sheet.tsx:120,161,184` | P1 |
| `IconButton` (exists, extend) | `accessibilityLabel, size, onPress` | `iconKey` + pressed shadow | raw icon pressables; chat header keys | P1 |
| `TextInput` (new) | `value, onChangeText, placeholder, invalid?, hint?` | `well` style object | 32 `<TextInput>` files | P1 |
| `Dialog` + `Sheet` (new shell over `Modal`) | `visible, onClose, title?, snap?: 'modal'\|'sheet'` | panel bg, backdrop, padding in one place | 24 Modal files; `integrations.tsx:278`, `machines.tsx:488,614`, `tool-detail-sheet.tsx:497`, `telegram-import-sheet.tsx:123` | P1 |
| `Toggle` (new; RN has no Switch use today) | `value, onValueChange, accessibilityLabel` | accent key on / well track off | hand-rolled toggle pressables; `integrations.tsx:200` + `onToggleShow` pattern (lines 161-172) | P1 |
| `SegmentedControl` (new) | same options API as web | `segment` active over well track | 14 segment/tab files incl. `chat/folder-tabs.tsx` | P1 |
| `ListRow` (new) | `icon?, title, subtitle?, chevron?, trailing?, onPress` | pressed `bg-surface-raised` | `settings/index.tsx:97`, `ais/ai-row.tsx:61` patterns | P1 |
| `Badge` (new) | `count, max?` | primary-key pill | 26 badge/unread files | P1 |
| `Avatar` (unify existing two) | `id, name, size, ai?, uri?` | `avatarShade()` | `chat/avatar.tsx` + `settings/avatar-control.tsx`; 35 caller files | P1 |
| `Chip` (new) | `label, active?, onPress` | raised pill / segment active | 18 chip files | P1 |
| `EmptyState` / `LoadingState` / `ErrorState` (new) | `title, hint?, action?` | raised pill | 111 empty/loading files | P1 |
| `SectionLabel` (new) | `children` | muted label | 23 ad-hoc section files | P1 |
| `PageHeader` with back (new) | `title, subtitle?, onBack?, trailing?` | 64px, bottom border | `settings/screen-shell.tsx` + per-screen `Stack.Screen` options | P2 |

`Text` exists (`text.tsx`) — keep as the base for all kit text. `useKeyPress`
stays as the press-state primitive for keys.

## 3. Shared tokens package proposal: `packages/ui-tokens`

A new package `packages/ui-tokens` exporting colours, radii, spacing and the
depth recipes as **plain data** (no DOM, no React Native imports), so both apps
can consume it without native or bundler coupling:

- `tokens.ts`: `colors` (every `--*` value below), `radii`, `spacing`, `fonts`,
  `shadows` (the exact shadow strings), `gradients` (the exact gradient stops).
- Web consumes it by generating CSS variables (a small build-time script writing
  `:root { … }`, or a Tailwind v4 `@theme` mapping referencing the values), and
  the depth utilities (`key-primary`, `key-icon`, `well-surface`, …) read the
  variables — recipes stay in CSS, values come from the package.
- Mobile consumes it by generating `lib/depth.ts` constants + the nativewind
  theme (`global.css` `@theme`/`:root` values) from the same source; literal-
  color files (`lib/colors.ts`, SVG fills, `ActivityIndicator` colors) import
  from the package instead of hard-coding.

**Tokens that differ today** (web `apps/web/src/index.css` vs mobile
`apps/mobile/src/global.css` vs `apps/mobile/src/lib/colors.ts`):

| Token | Web (`index.css`) | Mobile (`global.css` / `colors.ts`) |
|---|---|---|
| `--chat-background` | dot grid: `radial-gradient(#1c1c1c 1px, transparent 1px) 0 0 / 22px 22px var(--panel)` (line 133) | flat `#0a0a0a` (global.css line 52); `CHAT_BACKGROUND` in colors.ts lines 8-11 is `#000000` (page, not panel) |
| `--background` | alias `var(--panel)` (line 96) | literal `#0a0a0a` (line 33) — same value, alias vs literal |
| `--card`, `--popover`, `--secondary`, `--muted`, `--primary` (+ `-foreground`) | aliases to D24 vars (lines 97-105) | literals `#0a0a0a`/`#111111`/`#ededed` (lines 33-42) — same values, alias vs literal; mobile `--muted-foreground`/`--secondary-foreground` resolve through the same literals |
| `--ring` | alias `var(--muted-foreground)` (line 109) | literal `#a1a1a1` (line 46) |
| `--key-text-shadow` | `0 1px 0 rgba(255,255,255,.7)` (line 88; flips dark on a future blue accent) | **missing** — mobile `primaryKey` has no text shadow |
| `--avatar-ring` | `var(--panel)` (line 93; follows the row) | **missing** — no row-aware ring token |
| `--list-active-foreground` | `var(--foreground)` (line 113) | **missing** |
| `--voice-played` / `--voice-unplayed` | `#0a0a0a` / `#8a8a8a` (lines 129-130, bubble-relative) | **missing** in `global.css`/`colors.ts` |
| `--bubble-in-meta` / `--bubble-out-meta` | `var(--subtle-foreground)` / `#525252` (lines 121-122) | literals `#8a8a8a`/`#525252` in `BUBBLE_COLORS` (colors.ts lines 13-29) — same values |
| `--radius` | `0.75rem` both; but web derives `--radius-sm/md/lg/xl` (lines 60-63) | only `--radius: 0.75rem` (line 58); no sm/md/lg/xl scale |
| fonts / breakpoint | `--font-sans/mono` (Geist, lines 13-14), `--breakpoint-wide: 900px` (line 16) | **missing** (mobile uses system fonts; no breakpoint) |
| `PILL_SHADOW` | `raised-pill` has `inset 0 1px 0 rgba(255,255,255,.1)` top light, no `-1px` dark inner (index.css lines 264-271) | `PILL_SHADOW` in depth.ts lines 42-43 identical — same |
| `SEGMENT` gradient | `#333333 → #1c1c1c` (line 275) | `SEGMENT_GRADIENT` identical (depth.ts line 36) — same |

Everything else matches by value (`--page` `#000`, `--panel` `#0a0a0a`,
`--surface` `#111`, `--surface-raised` `#171717`, `--well` `#0c0c0c`,
`--border` `#1f1f1f`, `--border-strong` `#262626`, `--edge` `#050505`,
`--foreground`/`--accent` `#ededed`, `--accent-foreground` `#0a0a0a`,
`--muted-foreground` `#a1a1a1`, `--subtle-foreground` `#8a8a8a`,
`--generating-foreground` `#8f8f8f`, `--online` `#22c55e`, `--danger`/`--destructive`
`#ef4444`, `--badge-muted` `#333333`, bubble `#161616`/`#dedede`).

Decision needed in the tokens task: whether mobile adopts the dot-grid chat
background (needs an `expo-linear-gradient`/SVG dot implementation — native has
no CSS radial-gradient) or keeps flat `#0a0a0a` as an intentional divergence.

## 4. React Cosmos plan

Sources: official docs at `https://reactcosmos.org/docs/...` (note:
`cosmos.js.org` is NOT React Cosmos — it serves an unrelated crypto framework's
docs; do not use it) and npm metadata via `pnpm view` (no installs).

### 4a. Web (Vite)

- Current version: `react-cosmos@7.4.1` (`latest` dist-tag; canary
  `7.4.2-canary.*` also published — `pnpm view react-cosmos versions`, tail shows
  `7.4.1, 7.4.2-canary.aae77c6.0, 7.4.2-canary.dbb8c4b.0`). Peer deps only
  `react >= 18, react-dom >= 18` — fine for React 19.3.
  (`pnpm view react-cosmos@7.4.1 peerDependencies`.)
- Setup per https://reactcosmos.org/docs/getting-started/vite/ :
  `pnpm add -D react-cosmos react-cosmos-plugin-vite` (a later task runs this;
  NOT this task), `cosmos.config.json` with `{ "plugins":
  ["react-cosmos-plugin-vite"] }`, `cosmos` + `cosmos-export` npm scripts,
  Cosmos auto-discovers `apps/web/vite.config.ts` (override via
  `vite.configPath`). Dev UI defaults to `localhost:5000`, renderer on `5050`.
- Fixtures live next to the component as `*.fixture.tsx` (also `__fixtures__/`
  dirs or `fixture.tsx` supported —
  https://reactcosmos.org/docs/fixtures/file-conventions/ ). E.g.
  `apps/web/src/components/ui/button/button.fixture.tsx` (or keep flat
  `button.fixture.tsx` beside `button.tsx` — one fixture file per component
  variant group; multiple `Component/blankState.fixture.tsx` files per state).
- Fixtures stay out of the app bundle: Cosmos Vite plugin only includes
  fixtures in the Cosmos renderer build; the production `vite build` entry never
  imports `*.fixture.*`. Gate check: `cosmos-export` (static export) builds
  fixtures without shipping them — run it in CI/gate.

### 4b. Mobile (React Native / Expo)

- Package: `react-cosmos-native` (same release line as core; `pnpm view
  react-cosmos-native versions` tail shows `7.4.1-canary.5d13b43.0,
  7.4.2-canary.aae77c6.0, 7.4.2-canary.dbb8c4b.0` — latest stable lags core;
  pin whatever `latest` resolves to in the setup task and record it).
- How it runs per https://reactcosmos.org/docs/getting-started/react-native/ :
  NOT automatic — Metro needs a manual renderer entry. `cosmos-native` CLI
  generates `cosmos.imports.js` from fixtures; the app adds an `App.cosmos`
  entry rendering `NativeFixtureLoader`, and the root entry switches on
  `global.__DEV__`. The browser UI at `localhost:5000` drives fixture selection;
  rendering happens on-device/in-simulator. Our entry is expo-router based, not
  a single `App.js`, so the setup task must map `App.main` → the expo-router
  root and `App.cosmos` → a `NativeFixtureLoader` route — **support unknown**:
  the docs cover plain RN + Expo templates, not expo-router apps; whether the
  `__DEV__` switch coexists with expo-router's entry (`expo-router/entry`)
  needs a spike.
- Expo 57 / RN 0.86 / nativewind 4 / expo-router — **explicitly unknown**:
  the RN guide lists no compatibility matrix for Expo SDK, RN, nativewind or
  expo-router versions. `react-native-web ~0.21.0` is already a mobile dep, which
  keeps the fallback cheap. The setup task must verify on the actual stack and
  report; do not assume it works.
- **Fallback (recommended default):** run the RN kit through `react-native-web`
  inside the **web** Cosmos (https://reactcosmos.org/docs/getting-started/react-native/#react-native-for-web
  — Cosmos supports mirroring fixtures on DOM + native renderers). Fixtures for
  mobile kit components render with `react-native-web` in `apps/web` Cosmos;
  visual parity is approximate (shadows/gradients differ) but interaction/API
  coverage is real. Additionally/alternatively, a Cosmos-like catalog screen
  under the existing `apps/mobile/src/app/dev/` route (today only `whistle.tsx`)
  renders each kit component with knobs — zero new deps, works on-device, but
  manual.
- **Fixtures out of the bundle:** fixtures must NOT live under
  `apps/mobile/src/app/` — expo-router turns every file there into a route, and
  `apps/mobile/src/lib/routes-dir.test.ts` enforces **no `*.test.*` under
  `src/app`** (a test import pulls vitest/vite into the Metro bundle and the app
  fails to boot). Same hazard applies to `*.fixture.*` importing web-only
  modules. Rule: mobile fixtures live beside components (`components/ui/*.fixture.tsx`),
  never under `src/app/`; the catalog screen (if used) lives in `src/app/dev/`
  and imports components, never fixture files.

### 4c. Gate checks for fixtures

- Web: `pnpm --filter web cosmos-export` (static export) must succeed — proves
  every fixture compiles. Wire into `pnpm gate` as a step owned by the web
  package (see §5 gate proposal).
- Mobile: if native renderer is adopted, `cosmos.imports.js` generation
  (`cosmos-native` build step) must succeed; if the `react-native-web` fallback
  is used, mobile kit fixtures export through web Cosmos and are covered by the
  same `cosmos-export`. The `routes-dir.test.ts` invariant extends to fixtures:
  propose a test asserting no `*.fixture.*` under `src/app/`.

## 5. Migration plan (ordered small tasks)

Each task lists Allowed files and the duplicates it removes. Steps 1-3 create
the foundation; steps 4+ are one migration task per area, each landing
independently.

1. **T-new: `packages/ui-tokens` + codegen.** Allowed: `packages/ui-tokens/**`,
   `apps/web/src/index.css` (variable values only), `apps/mobile/src/global.css`
   (values only), `apps/mobile/src/lib/depth.ts` + `colors.ts` (values only).
   Removes: literal duplication of ~30 tokens across 3 files (§3 table); decides
   the dot-grid-on-native question. No visual change (values identical except
   noted diffs, which stay as-is with `TODO(T-new)` comments).
2. **T-new: web kit P1 + Cosmos.** Allowed: `apps/web/src/components/ui/**`,
   `apps/web/cosmos.config.json` + fixture files, `apps/web/package.json`
   (cosmos devDeps + scripts). Adds: `TextInput`, `TextArea`, `Dialog`,
   `SegmentedControl`, `ListRow`, `Badge`, unified `Avatar`, `Switch`,
   `Checkbox`, `EmptyState`, `LoadingState`, `ErrorState`; `*.fixture.tsx` per
   component; `cosmos-export` in gate. Removes nothing yet (migration tasks do).
3. **T-new: mobile kit P1 + Cosmos-or-fallback.** Allowed:
   `apps/mobile/src/components/ui/**`, `apps/mobile/src/app/dev/**` (catalog
   screen only), fixture files, `apps/mobile/package.json` (devDeps only if
   native renderer spikes green, else none). Adds: `TextInput`, `Dialog/Sheet`,
   `Toggle`, `SegmentedControl`, `ListRow`, `Badge`, unified `Avatar`, `Chip`,
   state components. Removes nothing yet. Records the Expo 57/RN
   0.86/nativewind 4/expo-router verdict with versions.
4. **T-new: migrate settings pages.** Allowed: settings screens web + mobile
   (`SettingsShell`, `NotificationsPage`, `ProfileSettingsSection`,
   `app/settings/**`). Removes: ad-hoc rows, toggles, inputs in settings.
5. **T-new: migrate chat list.** Allowed: `ChatList*`, `chat-list-item.tsx`,
   `folder-tabs.tsx`, `UnreadDivider`. Removes: hand-rolled rows, badges,
   segment controls in the list.
6. **T-new: migrate dialogs.** Allowed: the 18 web `role="dialog"` files + 24
   mobile Modal files (list in §1). Removes: bespoke dialog shells.
7. **T-new: migrate AI screens, composer, explore.** Allowed: `ais/**`,
   `composer*`, `ExplorePage*`, `channel-composer-bar.tsx`. Removes: remaining
   accent hand-rolls, chips, sheets.
8. **T-new: sweep + P2.** Allowed: whatever remains; adds `Menu`, `Card`,
   `SectionLabel`, `PageHeader`. Removes: last raw buttons/rows/headers.

**Gate check (hand-rolled accent buttons):** implemented as
`apps/web/src/components/ui/no-accent-pill.test.ts`. It scans every `*.tsx`
under `apps/web/src` outside `components/ui/`, matches the solid `bg-accent`
class token (tints such as `bg-accent/10` and prefixed ones such as
`hover:bg-accent/90` stay allowed), and fails when the nearest JSX tag is
`button`, `a` or `Link`. This replaces the earlier `rg 'bg-accent px-'`
proposal, which missed solid pills without a `px-` size class.

Mobile mirror: fail on new `<Pressable` with an inline accent background outside
`apps/mobile/src/components/ui/` (exact pattern TBD in the mobile kit task once
the `Button` API lands; start with counting `Pressable` files — 75 today, must
only go down).

## 6. Risks

- **Visual regressions.** The D24 depth recipes are shadow-exact; a kit
  component that is 1px off changes every screen at once. Mitigation: Cosmos
  fixtures per component + side-by-side screenshot review against current
  `main` before each migration task merges; `cosmos-export` in gate proves
  fixtures build.
- **Merges with running tasks.** T-0227 (composer), T-0233 (bottom bar),
  T-0232/T-0235 all touch the same screens the kit will migrate (composer,
  chat list, dialogs). Order migration tasks AFTER those land, or scope them to
  uncontended areas first (settings pages, explore). Each migration task should
  rebase onto the latest `main` and re-run its area's tests.
- **Cosmos-on-mobile may not work.** Expo 57 / RN 0.86 / nativewind 4 /
  expo-router support is unknown (docs have no matrix). Mitigation: fallback
  decided up front (RNW in web Cosmos + `src/app/dev/` catalog); the mobile kit
  task timeboxes the native-renderer spike and defaults to the fallback.
- **Token divergence creep.** Three token homes already disagree on 8+ tokens
  (§3). Mitigation: tokens package owns values; the gate diffs generated
  outputs (fail if `index.css`/`global.css`/`depth.ts` values drift from
  `packages/ui-tokens`).
- **Fixture bundle leaks (mobile).** A fixture under `src/app/` becomes a route
  and can pull test/dev imports into the Metro bundle (cf.
  `routes-dir.test.ts`). Mitigation: fixtures beside components only + proposed
  no-fixture-under-`src/app` test (§4c).

## 7. Verification of this audit (how to check my claims)

- Re-run any count, e.g. `rg --glob '!**/*.test.*' -o '<button' apps/web/src |
  wc -l` (expect 249) or `rg -l --glob '!**/*.test.*' 'bg-accent' apps/web/src |
  wc -l` (expect 32).
- Spot-check examples: `ExplorePage.tsx:253`, `ConfirmDialog.tsx:69`,
  `chat-list-item.tsx:65`, `settings/integrations.tsx:200,278`.
- Cosmos sources: https://reactcosmos.org/docs/getting-started/vite/ ,
  https://reactcosmos.org/docs/getting-started/react-native/ ,
  https://reactcosmos.org/docs/fixtures/file-conventions/ ; npm: `pnpm view
  react-cosmos versions`, `pnpm view react-cosmos-native versions`.
- Acceptance: no code/config/package change — `git status --short` shows only
  `docs/audit/ui-kit-audit.md` (new) + `work/T-0236-ui-kit-audit.md`; `pnpm gate`
  ends GATE PASS with no out-of-scope files.
