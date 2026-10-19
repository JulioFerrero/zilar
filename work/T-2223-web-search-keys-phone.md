---
id: T-2223
title: "Web search keys W2c (phone): grouped Add key provider sheet with tags, and Models / Web search sections on the phone Connections screen"
status: merged
milestone: M5
branch: task/T-2223-web-search-keys-phone
model: deepseek/deepseek-flash
effort: default
estimate: 40 min
---

# T-2223: Web search keys (phone)

## Spec (written by Claude, do not edit)

### Why
The phone twin of T-2220 (merged). Follow the approved design: `docs/design/mockups/web-search/README.md` plus `PhoneAddKey.dc.html` and `PhoneConnections.dc.html` (Julio, 2026-10-19). Read the README and those two boards first.

T-2220 added the shared parts in `packages/client-core/src/key-check.ts`, and the phone uses them through `useKeyCheck`:
- `keys.webChoices` (`{ id, label, hasKey, tag }`);
- a `tag` on model choices (DeepSeek);
- `webUseText(connection, all)`.

### Facts (read by the lead on 2026-10-19)
1. **Provider picker.** `ProviderStep` (`apps/mobile/src/components/ais/new-ai/provider-step.tsx:8-35`) maps `keys.choices` to `SelectSheetOption` with `dot`. It is used by the New AI sheet and by `AddKeySheet` (`apps/mobile/src/app/settings/connections.tsx:465`).
2. **Select sheet.** `SelectSheetOption` (`apps/mobile/src/components/ui/select-sheet.tsx:12-16`) has no group or tag.
3. **Connections list.** `ConnectionsList` renders one surface of `ConnectionRow` (`connections.tsx:447-459`). The row meta is reason · label · host · date (`connections.tsx:113-119`).
4. **Tokens.** `text-subtle-foreground` (`#8a8a8a`) and `font-mono` exist in the mobile Tailwind config.

### Steps
1. **`SelectSheet`:** `SelectSheetOption` gains optional `group?: string` and `tag?: string`.
   - **Groups:** when options carry `group`, render them in first-seen order under a group label. The label is `px-4 pt-3.5 pb-1.5 text-[13px] font-medium text-subtle-foreground` (board `.group`).
   - **Tag:** `font-mono text-[12px] text-subtle-foreground`, after the label and before the dot.
   - Rows stay 48 px. The filter still works across groups, and a group whose rows are all filtered out hides its label.
   - Options without `group` render exactly as today (New AI).
2. **`ProviderStep`:** a new prop `withWebSearch?: boolean`, passed only by `AddKeySheet`. When true:
   - model options get `group: 'Models'`;
   - `keys.webChoices` are appended with `group: 'Web search'`;
   - every option passes `tag` and `dot`.
3. **`ConnectionsList`:** split the connections into Models (provider not in `WEB_SEARCH_PROVIDER_IDS` from `@zilar/api-contract`) and Web search.
   - Render each non-empty group with a heading above its surface: `px-5 pb-2 text-[14px] font-medium text-foreground`. The Web search heading reads "Web search" followed by an inline `<Text className="font-normal text-subtle-foreground"> · for AIs whose model has none</Text>`, as on the board.
   - Put `gap-6` between the two groups.
   - In `ConnectionRow`, the meta becomes reason · label · host · `webUseText(connection, connections)` · date, each part only when present.
4. **No other change.** The sheet actions, replace, remove and the empty state stay as they are.

### Allowed files
- `apps/mobile/src/components/ui/select-sheet.tsx`
- `apps/mobile/src/components/ais/new-ai/provider-step.tsx`
- `apps/mobile/src/app/settings/connections.tsx`
- `apps/mobile/src/components/ui/bottom-sheet.tsx`
- `work/T-2223-web-search-keys-phone.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes; no new tests (UI).
- The lead checks on the emulator in mock mode, against the boards:
  - Settings › Connections shows Models (DeepSeek "Personal key · Model, search, read · Sep 23") and Web search with the hint (Brave Search "Search · Oct 19", Jina "Read · Oct 19").
  - Add key's provider sheet shows the "Models" and "Web search" groups with mono tags.
  - The New AI provider sheet is unchanged.
- **Scroll (lead, 11:20).** On the Android emulator, the Add key provider list scrolls with a finger drag down to xAI and to the "Web search" group and Tavily.
  - Today the list does not move: `SelectSheet`'s inner `ScrollView` (`maxHeight: MAX_ROWS * ROW_HEIGHT`) sits inside TrueSheet content, and TrueSheet needs its `scrollable` mode on Android. This was already broken on main, where the 7-row cap hid xAI.
  - The fix may add an opt-in prop to `BottomSheet` (`apps/mobile/src/components/ui/bottom-sheet.tsx`) that turns on TrueSheet's `scrollable` with a fixed detent (it cannot be combined with `auto`; read `node_modules/@lodev09/react-native-true-sheet/lib/typescript/src/TrueSheet.types.d.ts`). `SelectSheet` uses it and drops its nested capped `ScrollView`.
  - Every other sheet stays as it is.

---

## Report (written by the worker when done)

### What I did
- `SelectSheet`: `SelectSheetOption` now takes optional `group` and `tag`. Shown options are bucketed into a `Map` in first-seen order; each named group renders a label with the board's classes (`px-4 pt-3.5 pb-1.5 text-[13px] font-medium text-subtle-foreground`). A tag renders after the label and before the dot as `font-mono text-[12px] text-subtle-foreground`. Rows stay `h-12`; filtering runs before grouping, so a group whose rows all filter out also drops its label. Options without `group` render in a single unnamed bucket, so the New AI sheet looks as before.
- `ProviderStep`: new optional `withWebSearch` prop. When true, model choices get `group: 'Models'` plus their `tag`, and `keys.webChoices` are appended under `group: 'Web search'` with their tag. Dots still appear only for providers that have an active key. The default path (New AI) emits no group or tag.
- `AddKeySheet`: passes `withWebSearch` to `ProviderStep`; New AI does not.
- `ConnectionsList`: splits connections with `WEB_SEARCH_PROVIDER_IDS` (widened once to `readonly string[]` because the contract tuple's `includes` takes only its literal union) into Models and Web search. A small `ConnectionSurface` renders each non-empty group as a heading plus the existing card; the two groups sit in a `gap-6` column. The Web search heading has the inline hint `· for AIs whose model has none`. `ConnectionRow` takes the computed `webUseText(connection, all)` and renders the meta as reason · label · host · use · date, each part only when present.

### Files changed
- `apps/mobile/src/components/ui/select-sheet.tsx`
- `apps/mobile/src/components/ui/bottom-sheet.tsx`
- `apps/mobile/src/components/ais/new-ai/provider-step.tsx`
- `apps/mobile/src/app/settings/connections.tsx`
- `work/T-2223-web-search-keys-phone.md`

### Commands and results
- `pnpm install` — done, 1 pre-existing peer warning (`@types/react-dom` vs `@types/react`).
- `pnpm gate` (first run) — GATE FAIL at format: `select-sheet.tsx` needed Prettier. Fixed with `pnpm exec prettier --write apps/mobile/src/components/ui/select-sheet.tsx`.
- `pnpm gate` (final state) — GATE PASS. Summary:
  - `PASS install (frozen)`
  - `PASS format`
  - `PASS lint`
  - `PASS typecheck`
  - `PASS effect`
  - `SKIP build @zilar/server (no server, package or manifest change)`
  - `PASS tests @zilar/mobile`
  - `scope: every changed file is inside the Allowed files`
  - `WARN size: apps/mobile/src/app/settings/connections.tsx: 605 lines (main 541); limit 400 (soft limit; fine when keeping the file whole saves lines)`
  - `GATE PASS`
- No single test files were run: this is UI-only and the task specifies no new tests; `pnpm gate` ran the mobile package's tests.

### Problems / deviations
- None blocking. `webUseText` is evaluated in the list and passed to `ConnectionRow` as `useText` instead of calling it inside the row, which keeps the row free of the full list; the rendered meta is exactly the spec order.
- I did not test on the emulator (not available here); the visual acceptance is for the lead/Julio.

### Round 2 — Android scroll
- Read the TrueSheet 3.11.16 types: `scrollable` makes TrueSheet drive a child ScrollView on Android, `scrollableOptions` is not needed for a single detent, and `auto` cannot be combined with `scrollable`, so a scrollable sheet gets one fixed detent.
- `BottomSheet`: new opt-in `scrollable?: boolean` (default `false`). When false nothing changes: `detents={['auto']}`, `maxContentHeight`, and the existing `maxHeight` cap. When true it passes `scrollable`, one fixed detent from `maxHeightFraction(maxHeightClassName)` (0.85 by default), and lets the outer View and the content ScrollView flex, so the scroll view fills the fixed sheet between the header and footer.
- `SelectSheet`: passes `scrollable` and drops its nested capped `ScrollView` together with `MAX_ROWS`/`ROW_HEIGHT`. The filter, group labels, rows and the OpenAI-compatible footer option now live in the BottomSheet's one scroll view. Row height, groups and tags are unchanged.
- `pnpm gate` (Round 2) — GATE PASS:
  - `PASS install (frozen)`
  - `PASS format`
  - `PASS lint`
  - `PASS typecheck`
  - `PASS effect`
  - `SKIP build @zilar/server (no server, package or manifest change)`
  - `PASS tests @zilar/mobile`
  - `scope: every changed file is inside the Allowed files`
  - `WARN size: apps/mobile/src/app/settings/connections.tsx: 605 lines (main 541); limit 400 (soft limit; fine when keeping the file whole saves lines)`
  - `GATE PASS`
- Not tested on the emulator here; the drag-to-Tavily check is the lead's.

### Round 3 — detent only when the list needs it
- `SelectSheet` counts the full option list plus its group labels plus the footer option and passes `scrollable` only when that is over `MAX_ROWS` (7). Short pickers (machines, models) keep TrueSheet's `auto` detent and size to their content; the provider lists still scroll as in Round 2. The count uses the whole list, so typing a filter does not resize an open sheet.
- `pnpm gate`: GATE PASS on the Round 3 state.

### Round 4 — height-based detent
- `SelectSheet` now decides `scrollable` by height instead of a row count: `useWindowDimensions().height × 0.85` (the `BottomSheet` default) minus 88 px for the title/grabber row and scroll padding, compared with 48 px rows + 36 px group labels + the 46 px filter when shown + the 48 px footer option. `MAX_ROWS` is gone.
- New AI's 8 rows (384 px + 48 px footer) fit, so it keeps the `auto` detent; the Add key list is taller and still scrolls.
- `pnpm gate`: GATE PASS on the Round 4 state.


## Review (written by Claude)

Approved after 3 lead rounds. Net +132 for a new feature, the phone twin of web search W2.

**What changed:**
- The phone Add key provider sheet is grouped: Models, then Web search (Brave, Exa, Firecrawl, Jina, Tavily), with Search and Read tags.
- Connections has Models and Web search sections, matching `PhoneConnections.dc.html`.
- New AI lists model providers only.
- **Scroll fix:** the nested ScrollView inside TrueSheet did not scroll on Android. It was already broken on main, where the 7-row cap hid xAI. `BottomSheet` now has an opt-in TrueSheet `scrollable` mode with a fixed detent, and `SelectSheet` turns it on only when the content is taller than 85% of the screen.

**Lead checks** (emulator, mock build of the branch):
- The Add key provider list (16 rows) drags to "OpenAI-compatible".
- The New AI provider list (8 rows) sizes to its content.
- The attach and message-action sheets still size to their content.
- Connections shows both sections.
