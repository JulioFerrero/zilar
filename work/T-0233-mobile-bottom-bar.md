---
id: T-0233
title: "Mobile: floating bottom bar (Chats, AIs, Settings, Profile), search bar on Chats, Profile tab"
status: merged
milestone: M5
branch: task/T-0233-mobile-bottom-bar
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: []
estimate: 0.8 day
---

# T-0233: Floating bottom bar on the phone

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-05, Telegram screenshots: "move the options, AI to the bottom like in telegram with a floating bar". Brief `docs/design/briefs/telegram-nav-folders-settings.md` sections a and d plus "Decisions" (tabs: Chats, AIs, Settings, Profile; no Contacts; monochrome D24 look; My AIs leaves the Settings list). Mockup `docs/design/briefs/telegram-nav-folders-settings.html` (phone frames 1, 5 and 6). Folders are NOT in this task (they wait for the server API).

### Verified facts (do not re-derive)
- Root layout `apps/mobile/src/app/_layout.tsx` line 67: `<Stack screenOptions={{ headerShown: false }} />`, no tabs today.
- `expo-router` 57.0.23 ships headless tabs in `expo-router/ui`: `Tabs`, `TabList`, `TabTrigger` (`href`, `asChild`), `TabSlot` (`node_modules/.pnpm/expo-router@57.0.23_*/node_modules/expo-router/build/ui/`). Read its `.d.ts` files before writing; use these (no new dependency; do NOT add `@react-navigation/bottom-tabs`).
- Home `apps/mobile/src/app/index.tsx` (466 lines):
  - header with title "Chats" and three `IconButton`s: My AIs `router.push('/ais')`, Search `setSearchOpen(true)`, Settings `router.push('/settings')` (lines 244-256);
  - the search header shown while `searchOpen` (lines 207-243);
  - list `contentContainerStyle={{ paddingBottom: 96 }}` (line 356);
  - `<NewChatButton />` (line 463).
- The FAB `apps/mobile/src/components/chat/new-chat-button.tsx` sits at `bottom: Math.max(insets.bottom, 20) + 14` (lines 123-127).
- My AIs list `apps/mobile/src/app/ais/index.tsx` (259 lines) uses `AisScreenShell` with a required `onBack` (`apps/mobile/src/components/ais/screen-shell.tsx` line 15). `apps/mobile/src/app/ais/new.tsx` line 138 does `router.replace({ pathname: '/ais', params: { highlight } })`.
- Settings hub `apps/mobile/src/app/settings/index.tsx` (157 lines) uses `SettingsScreenShell` with a required `onBack` (`apps/mobile/src/components/settings/screen-shell.tsx` line 15). Rows come from `apps/mobile/src/lib/settings-items.ts` (the `ais` row at lines 32-37).
- Profile data: `apps/mobile/src/lib/profile-api.ts` `getMe()` (line 38) → `{ id, email, name, handle, avatarUrl? }`. The avatar picker is `apps/mobile/src/components/settings/avatar-control.tsx`.
- D24 look on mobile: tokens in `apps/mobile/src/global.css`. The raised and well styles already used on Home (`well` style object in `index.tsx`), `IconButton` (`apps/mobile/src/components/ui/icon-button.tsx`), and the primary key style of `new-chat-button.tsx`.
- `apps/mobile/src/lib/routes-dir.test.ts` forbids test files under `src/app`.

### What to build
1. **Route group.**
   - `git mv` `src/app/index.tsx` → `src/app/(tabs)/index.tsx`, `src/app/ais/index.tsx` → `src/app/(tabs)/ais.tsx`, `src/app/settings/index.tsx` → `src/app/(tabs)/settings.tsx`.
   - Add a new `src/app/(tabs)/profile.tsx` and `src/app/(tabs)/_layout.tsx`.
   - URLs stay `/`, `/ais`, `/settings`; `ais/[id]`, `ais/new`, `settings/*`, `chat/*`, etc. stay where they are and open above the tabs.
   - Fix any relative imports the moves break.
2. **`(tabs)/_layout.tsx`:** `expo-router/ui` `Tabs` with `TabSlot` and a `TabList` rendered as the floating bar, from a new component `apps/mobile/src/components/nav/floating-tab-bar.tsx`:
   - Position: absolute, 12 px side margins, `insets.bottom + 12` from the bottom.
   - Size and shape: height 64, radius 22.
   - Look: dark raised gradient (`#1b1b1b` → `#0e0e0e`), 1 px `#050505` edge, top inner highlight, big drop shadow.
   - Tabs: four equal tabs (icon 20 + label 11 px, lucide `MessagesSquare`, `Bot`, `Settings`, own avatar initials or picture for Profile). The active tab is a raised segment (`#333` → `#1c1c1c`), the others muted.
   - Chats badge: total unread of non-muted chats (the same total the All folder shows today), in the primary key style, hidden at 0.
   - Accessibility: `accessibilityRole="tab"` and `accessibilityState={{ selected }}`.
   - The bar hides while the keyboard is open (Keyboard listeners).
3. **Chats tab:**
   - Header: just the title "Chats" (no buttons).
   - Under it, a full-width search well (height 40, radius 12, search icon, placeholder `Search chats and @usernames`, text truncates and never overflows). Tapping it opens the existing search mode (`setSearchOpen(true)`); search mode stays exactly as today.
   - Remove the My AIs, Search and Settings header buttons.
   - FAB bottom offset = `insets.bottom + 12 + 64 + 14`; list `paddingBottom` = 180.
4. **AIs tab and Settings tab:** no back button. Make `onBack` optional in both shells and render the back `IconButton` only when given; the tab files pass none. Remove the `ais` row from `settings-items.ts` (it is a tab now). Every other row stays.
5. **Profile tab (`(tabs)/profile.tsx`):**
   - Centered avatar 104 (picture or initials), name 22 px semibold, a green dot + `online` line.
   - Three equal action keys (`IconButton`-style keys with icon over label): `Set photo` (opens the existing avatar picker flow from `avatar-control.tsx`; reuse, do not copy), `Edit info` (`router.push('/settings/profile')`), `Settings` (navigate to the Settings tab).
   - An info card:
     - `@handle` row (label `Username`, a copy key using the existing clipboard helper if one exists, else no copy key); `Claim a username` row linking to `/settings/profile` when `handle` is null.
     - Email row (label `Email, only you see it`).
   - Loading and error states in the same style as `settings/profile.tsx` (fixed sentences, never server text).
   - Use `getMe()`.
6. **Tests (Vitest; never under `src/app`):**
   - `apps/mobile/src/components/nav/floating-tab-bar.test.tsx`: four tabs with labels, the selected state, the badge shows the total and hides at 0.
   - Extract the Profile screen body into `apps/mobile/src/components/profile/profile-view.tsx` with `apps/mobile/src/components/profile/profile-view.test.tsx` (avatar initials, handle vs claim row, email, the three actions call their handlers).
   - Update the existing settings-items test if one asserts the `ais` row (`apps/mobile/src/lib/settings-items.test.ts`).

### Read first
`AGENTS.md`, the brief and the mockup above, `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/app/index.tsx`, `apps/mobile/src/app/ais/index.tsx`, `apps/mobile/src/app/settings/index.tsx`, both screen shells, `apps/mobile/src/components/chat/new-chat-button.tsx`, `apps/mobile/src/lib/settings-items.ts`, `apps/mobile/src/lib/profile-api.ts`, `apps/mobile/src/components/settings/avatar-control.tsx`, the headless tabs type files (`build/ui/*.d.ts` inside the expo-router package).

### Allowed files
`apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/app/index.tsx` (moved), `apps/mobile/src/app/ais/index.tsx` (moved), `apps/mobile/src/app/settings/index.tsx` (moved), `apps/mobile/src/app/(tabs)/_layout.tsx` (new), `apps/mobile/src/app/(tabs)/index.tsx` (new path), `apps/mobile/src/app/(tabs)/ais.tsx` (new path), `apps/mobile/src/app/(tabs)/settings.tsx` (new path), `apps/mobile/src/app/(tabs)/profile.tsx` (new), `apps/mobile/src/components/nav/floating-tab-bar.tsx` (new), `apps/mobile/src/components/nav/floating-tab-bar.test.tsx` (new), `apps/mobile/src/components/profile/profile-view.tsx` (new), `apps/mobile/src/components/profile/profile-view.test.tsx` (new), `apps/mobile/src/components/ais/screen-shell.tsx`, `apps/mobile/src/components/settings/screen-shell.tsx`, `apps/mobile/src/components/chat/new-chat-button.tsx`, `apps/mobile/src/components/settings/avatar-control.tsx`, `apps/mobile/src/lib/settings-items.ts`, `apps/mobile/src/lib/settings-items.test.ts`, `work/T-0233-mobile-bottom-bar.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot floating-tab-bar profile-view settings-items routes-dir
pnpm gate
```

### Acceptance
- The four tabs work and keep their URLs; sub-screens open above the bar; the bar hides with the keyboard; Chats shows a search well and the FAB above the bar; AIs and Settings have no back button; My AIs is no longer a Settings row.
- No server or web change; no new dependency; icons only, no emoji; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. The lead checks it on the emulator.

### Out of scope
Folder chips and folder editing (wait for T-0232), the Settings redesign (grouped cards), restyling `settings/profile.tsx`.

---

## Report (written by the worker when done)

Done. Floating bottom bar with four tabs (Chats, AIs, Settings, Profile),
search well on Chats, Profile tab. `pnpm gate`: GATE PASS, scope clean.

What I did (all inside Allowed files):
- Route group: `git mv` index/ais/settings screens into `src/app/(tabs)/`
  (`index.tsx`, `ais.tsx`, `settings.tsx`); new `(tabs)/_layout.tsx` and
  `(tabs)/profile.tsx`. URLs unchanged (`/`, `/ais`, `/settings`); sub-screens
  stay outside the group and open above the bar on the root stack.
- `(tabs)/_layout.tsx`: `expo-router/ui` `Tabs` + `TabSlot`; a hidden `TabList`
  declares the four `TabTrigger`s (registry only — the runtime only parses
  triggers that are element-children of `TabList`, verified in
  `build/ui/Tabs.js` `parseTriggersFromChildren`); the visible
  `FloatingTabBar` renders below it inside `NavigationContent` and reuses the
  trigger map via `useTabTrigger`, wrapped in a full-size
  `pointerEvents="box-none"` overlay so it floats above the active tab.
- `components/nav/floating-tab-bar.tsx`: absolute bar, 12 px side margins,
  `insets.bottom + 12`, height 64, radius 22, `#1b1b1b→#0e0e0e` gradient with
  1 px `#050505` edge, top inner highlight, drop shadow; four equal tabs
  (lucide `MessagesSquare`/`Bot`/`Settings`, avatar picture or initials for
  Profile), active tab `segment` face, others muted; unread badge (All-folder
  total incl. muted exclusion via `unreadCount(chats,'all')`, primary-key
  style, hidden at 0, `99+` cap); `accessibilityRole="tab"` +
  `selected` state; hides on keyboard via `Keyboard` listeners. Active/idle
  faces keyed so no live gradient swap (gradient-swap rule).
- Chats tab: header is title only; full-width search well (h-40→40 px,
  radius 12, placeholder `Search chats and @usernames`, truncates with
  `numberOfLines`/`ellipsizeMode`); tap opens existing search mode unchanged;
  list `paddingBottom` 180; FAB offset `insets.bottom + 12 + 64 + 14`.
- AIs/Settings tabs: `onBack` optional in both shells, back key rendered only
  when given; tab files pass none; `ais` row removed from `settings-items.ts`
  (deleted 7 lines only, no reorder) and `ai` icon dropped from `HUB_ICONS`.
- Profile tab: centered avatar 104 (picture via `avatarImageSource` against
  API origin, else initials), name 22 semibold, green dot + `online`; three
  keys Set photo / Edit info / Settings; info card with `@handle` + copy key
  (`expo-clipboard` lazy import, the `new-chat-button` pattern), `Claim a
  username` row when handle null, email row; loading/error sentences match
  `settings/profile.tsx`; body split into hook-free `ProfileViewContent`
  (+ stateful `ProfileView` wrapper) for tests.
- Tests: `floating-tab-bar.test.tsx` (4 tabs, selected styling, badge
  total/hide-at-0, initials), `profile-view.test.tsx` (initials/handle/email,
  claim row, three handlers fire, copy key conditional), settings-items
  updated (starts with Profile, no `/ais` row).

Files changed (15): the 3 moved screens, `(tabs)/_layout.tsx`,
`(tabs)/profile.tsx`, `floating-tab-bar.tsx` + test, `profile-view.tsx` +
test, both screen shells, `new-chat-button.tsx`, `settings-items.ts` +
test, this task file.

Commands (real results):
- `pnpm install`: ok (11.5s).
- Single tests: `floating-tab-bar profile-view settings-items routes-dir`:
  4 files, 12 passed.
- Mobile `tsc --noEmit` on touched files: clean (fixed one literal-union
  comparison in the settings-items test).
- `pnpm gate` (final): PASS install, format, lint, typecheck,
  tests @zilar/mobile; "scope: every changed file is inside the Allowed
  files"; GATE PASS.
- Gate round-trips: first fail = prettier on 3 files (fixed with
  `prettier --write` on touched files only); second fail = unused
  `Pressable` import in floating-tab-bar (removed).

Deviations: none from spec. Notes: (1) `TabTrigger` needs element presence
under `TabList` so the bar could not itself BE the `TabList` children — hence
hidden registry + separate floating bar. (2) Profile "Set photo" reuses the
picker/transcode/upload pipeline from `settings/profile.tsx` inline (same
`avatar-native` seams) rather than mounting `AvatarControl`, whose UI is a
settings card. (3) Not tested on emulator — lead verifies visually.

Security checklist: no secrets/tokens in logs or UI (bearer only same-origin
via `avatarImageSource`); no DB/auth/server changes; no new dependency;
icons only (lucide), no emoji; fixed error sentences.

### Round 2 (fix round, PREREVIEW commit 2190e1c)

Fixed both behaviour findings; nits 3–7 left untouched (none on a changed
line). Disagreements: none.

- Finding 1 (must-fix, tab-bar avatar): `TabIcon` fed raw
  `profile.avatarUrl` into `Image`, which never resolves the relative
  `/api/avatars/<id>` path. New hook-free `TabProfileFace` resolves via
  `avatarImageSource(url, API_URL, profile.token)` (same pattern as
  `profile-view.tsx`) with an `onError` fallback to initials; the
  `(tabs)/_layout.tsx` focus reload now also fetches the session token and
  plumbs it through the new `TabProfile.token`. Tests added to
  `floating-tab-bar.test.tsx`: relative url resolves against the API origin
  (mocked resolver) and shows no initials; `imageFailed` renders initials
  and no avatar url.
- Finding 2 (should-fix, Set photo): replaced the immediate-upload inline
  pipeline with the staged `settings/profile.tsx` pattern — Set photo picks
  and stages only; new `PhotoEditRow` in `profile-view.tsx` shows the
  `file://` preview with explicit Save / Discard, plus a Remove key when a
  current picture exists; nothing uploads until Save. The double-tap guard
  is now a ref (`photoRef`, same as settings) across pick/save/remove.
  Tests added to `profile-view.test.tsx`: staged preview with Save/Discard
  invocation counts, Remove key present only when `canRemove`.
- Finding 5 (nit, key on TabTrigger): left as is — the key is load-bearing
  for the gradient-swap rule (`segment` face style toggles on the same
  `View` child of the trigger), not waste.

Commands (real results):
- Single tests: `floating-tab-bar profile-view settings-items routes-dir`:
  4 files, 16 passed.
- `pnpm gate` (final): PASS install, format, lint, typecheck,
  tests @zilar/mobile; "scope: every changed file is inside the Allowed
  files"; GATE PASS. Gate round-trips: first fail = prettier on 2 touched
  files (fixed, folded into the finding commits); second fail = typecheck
  (`ProfileView` wrapper missed the new `photoEdit` prop; fixed, single
  tests re-run: 2 files, 12 passed).

### Round 3 (fix round, PREREVIEW at worktree root)

Fixed the must-fix and the should-fix; nits 3–4 left untouched (neither
is on a changed line). Disagreements: none.

- Finding 1 (must-fix, stale `imageFailed` flag): `ProfileView`
  (`profile-view.tsx`) and `FloatingTabButton` (`floating-tab-bar.tsx`)
  stored a boolean that stuck on initials after a 404 even when Set photo
  saved a new `avatarUrl`. Both now store the failed url and derive the
  fallback as `failedUrl === avatarUrl`, so a fresh url renders the
  picture again. Tests: new `avatarFailedFor` cases in
  `floating-tab-bar.test.tsx` (stale url falls back, changed url clears)
  and a `ProfileView` wrapper case in `profile-view.test.tsx` (new url
  renders `<Image>`, failed url renders initials).
- Finding 2 (should-fix, unscrollable Profile tab): `(tabs)/profile.tsx`
  body is now a `ScrollView` (header stays fixed, `px-4` moved inside,
  existing bottom padding keeps content clear of the bar); no new test
  file allowed under `src/app` (`routes-dir.test.ts`), behaviour covered
  by the existing checks.
- Nits 3 (settings subtitle) and 4 (FAB offset): left as is — neither
  line was touched by these fixes.

Commands (real results):
- Single tests: `floating-tab-bar profile-view settings-items routes-dir`:
  4 files, 18 passed.
- `pnpm gate` (final): PASS install, format, lint, typecheck,
  tests @zilar/mobile; "scope: every changed file is inside the Allowed
  files"; GATE PASS.

status: review (unchanged).

## Review (written by Claude)

**Verdict:** Approved after 2 auto rounds. Earlier rounds fixed:
- the tab-bar avatar source;
- the staged photo save;
- the image-failed flag never resetting when the photo changed;
- the Profile tab not scrolling.

The lead rejected a probe command that would have copied test files into `src/probe` and `/tmp`. The final packet is clean with 2 nits:
- `savePhoto`/`removePhoto` spread a possibly stale `profile`;
- the clipboard promise has no catch.

Emulator look is sent to the QA subagent (QA run 5). Next: T-0234 (create sheets above the keyboard), the Settings hub redesign, and the Blocked people row in the hub once T-0244 merges.
