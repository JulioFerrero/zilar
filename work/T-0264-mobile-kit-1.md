---
id: T-0264
title: "Mobile kit batch 1: IconTile, ListRow, Card, SectionLabel and CountBadge in components/ui, used by the Settings hub and Chat folders, plus a hidden kit catalog screen"
status: todo
milestone: M5
branch: task/T-0264-mobile-kit-1
model: auto
effort: low
depends_on: [T-0247, T-0255]
estimate: 0.4 day
---

# T-0264: mobile kit batch 1

## Spec (written by Claude, do not edit)

### Why
This is audit step 3 (`docs/audit/ui-kit-audit.md` §2b, §4b and §5.3). The web kit has `ListRow`, `Card`, `SectionLabel` and `Badge` (T-0246), but mobile still builds these inline per screen. The audit's safe default for a mobile catalog is a hidden screen under `apps/mobile/src/app/dev/` with no new dependency (§4b fallback). The names match the web kit.

### Verified facts (do not re-derive)
- The mobile kit today, in `apps/mobile/src/components/ui/`, is `button.tsx`, `icon-button.tsx`, `text.tsx` and `use-key-press.ts`. Depth recipes live in `apps/mobile/src/lib/depth.ts` (`iconKey` at line 65).
- `apps/mobile/src/app/(tabs)/settings.tsx`:
  - `IconTile` (lines 66-84): a 34x34 `iconKey` view, radius 10;
  - `SettingsRow` (lines 121-155): icon tile, title 15/500, a one-line subtitle 13 muted, an optional count pill (`rounded-full bg-accent`, 11/600) and `ChevronRight` 18 muted;
  - `GroupCard` (lines 157-185): an uppercase 11/600 label with `tracking-[0.08em] text-subtle-foreground`, then a `rounded-2xl border border-border bg-surface` card whose rows after the first get `border-t border-divider`.
- `apps/mobile/src/app/settings/folders.tsx` `FolderRow` (lines 128-191) repeats the same row shape: a 36x36 `iconKey` tile with radius 12, title, subtitle and chevron, plus up/down icon buttons; the card dividers are at line 148.
- The hidden dev route pattern is `apps/mobile/src/app/dev/whistle.tsx`, reachable only by URL (doc comment lines 1-5). Tests may not live under `src/app` (`apps/mobile/src/lib/routes-dir.test.ts`).

### What to build
1. **New kit files in `apps/mobile/src/components/ui/`:**
   - `icon-tile.tsx`: `IconTile({ children, size = 34, radius = 10, testID? })`;
   - `list-row.tsx`: `ListRow({ icon?, title, subtitle?, count?, chevron = true, onPress?, accessibilityLabel?, trailing?, disabled? })` with the `SettingsRow` look; it is a `Pressable` when `onPress` is set, else a `View`;
   - `card.tsx`: `Card({ children })`, which puts the divider between children itself (no `first` prop), and `SectionLabel({ children })` with the `GroupCard` label look;
   - `count-badge.tsx`: `CountBadge({ count })`, which renders nothing at 0 or below.
   Lucide icons only, no emoji, colours from `@/lib/colors` and the className tokens.
2. **Migrate:**
   - `(tabs)/settings.tsx` uses `SectionLabel`, `Card`, `ListRow`, `IconTile` and `CountBadge` in place of its local `IconTile`, `SettingsRow` and `GroupCard` (delete them). It must look the same; keep every accessibility label and `testID`.
   - `settings/folders.tsx` `FolderRow` uses `IconTile`, with the up/down buttons kept as `ListRow`'s leading content or around it, whichever keeps the layout identical. Its list uses `Card`.
3. **Catalog:** add a hidden screen `apps/mobile/src/app/dev/kit.tsx` (open it with `zilar://dev/kit`; linked from nowhere) that renders every kit component (Button variants, IconButton, IconTile, ListRow variants, Card plus SectionLabel, CountBadge) with sample content in a ScrollView. Put a doc comment like whistle's at the top.
4. **Tests:** `apps/mobile/src/components/ui/kit.test.tsx`: `ListRow` renders title, subtitle, a count at or above 1 and no count at 0, and its chevron toggles; `Card` puts dividers only between children; `CountBadge` renders nothing at 0. Existing tests for the settings hub and folders keep passing.

### Read first
`AGENTS.md`, `docs/audit/ui-kit-audit.md` (§2b, §4b), `apps/mobile/src/app/(tabs)/settings.tsx`, `apps/mobile/src/app/settings/folders.tsx`, `apps/mobile/src/components/ui/icon-button.tsx`, `apps/mobile/src/app/dev/whistle.tsx` (lines 1-20).

### Allowed files
`apps/mobile/src/components/ui/icon-tile.tsx` (new), `apps/mobile/src/components/ui/list-row.tsx` (new), `apps/mobile/src/components/ui/card.tsx` (new), `apps/mobile/src/components/ui/count-badge.tsx` (new), `apps/mobile/src/components/ui/kit.test.tsx` (new), `apps/mobile/src/app/dev/kit.tsx` (new), `apps/mobile/src/app/(tabs)/settings.tsx`, `apps/mobile/src/app/settings/folders.tsx`, `work/T-0264-mobile-kit-1.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit settings-items hub folders
pnpm gate
```

### Acceptance
- The Settings hub and Chat folders look as before but are built from the kit. `zilar://dev/kit` shows the catalog.
- No new dependency.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

### Out of scope
Other screens (later migration tasks), react-cosmos-native, and the react-native-web mirror in the web Cosmos.

---

## Report (written by the worker when done)

## Review (written by Claude)
