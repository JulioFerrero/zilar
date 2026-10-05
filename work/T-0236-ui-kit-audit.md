---
id: T-0236
title: "Audit: duplicated UI on web and mobile, the shared kit to build, and how React Cosmos fits (docs only)"
status: planned
milestone: M5
branch: task/T-0236-ui-kit-audit
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: []
estimate: 0.5 day
---

# T-0236: UI kit audit

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-05: "do we have a shared button or are we duplicating code? I would like a storybook or react cosmos with all the reusable UI elements". His decisions: **React Cosmos for both web and mobile**; rollout = this audit → shared design tokens + a kit per app + Cosmos catalog → one migration task per area. This task writes the audit only. NO code, config or package changes.

### Verified facts (lead, 2026-10-05)
- Web kit `apps/web/src/components/ui/`: only `button.tsx` (cva variants), `icon-button.tsx`, `well.tsx`.
  - 13 non-test files import `Button`; 249 raw `<button>` in `apps/web/src`.
  - 25 files hand-roll the accent button with raw classes (e.g. `apps/web/src/components/ContactProfileRow.tsx` lines 152-158).
  - 18 files build their own `role="dialog"` shell.
  - The D24 depth recipes are utilities in `apps/web/src/index.css` (`key-primary`, `key-icon`, `well-surface`, `raised-pill`, `segment-raised`, lines 186-284); only 7 files use `key-primary`.
- Mobile kit `apps/mobile/src/components/ui/`: `button.tsx`, `icon-button.tsx`, `text.tsx`, `use-key-press.ts`.
  - Depth styles are centralised in `apps/mobile/src/lib/depth.ts` (`well` at line 80).
  - 13 non-test files import the mobile `Button`; 342 raw `<Pressable>`.
- Two Avatar implementations per app (`apps/web/src/components/Avatar.tsx`, `apps/web/src/components/AvatarUploader.tsx`; `apps/mobile/src/components/chat/avatar.tsx`, `apps/mobile/src/components/settings/avatar-control.tsx`).
- Tokens live twice: `apps/web/src/index.css` (`:root` lines 66-130) and `apps/mobile/src/global.css`, plus `apps/mobile/src/lib/colors.ts`. There is no shared UI or token package (`packages/` holds agent-drivers, chat-core, devtools, protocol, runner-tunnel, xmpp-core).
- Versions: web React ^19.3 + Vite ^8.3 (`apps/web/package.json`); mobile Expo ~57.0.25, React Native 0.86.3, React 19.2.3, nativewind 4.2.7 (`apps/mobile/package.json`). The mobile app has a hidden `apps/mobile/src/app/dev/` route folder.
- Design spec: `docs/design/ui-style.md` (D24), approved mockups in `docs/design/mockups/`, new brief `docs/design/briefs/telegram-nav-folders-settings.md`.

### What to write: `docs/audit/ui-kit-audit.md`
1. **Inventory per app:** every repeated UI pattern you find, with counts and 3-5 `file:line` examples each:
   - primary/secondary/danger/ghost buttons, icon buttons;
   - text inputs and wells;
   - dialogs and modals, bottom sheets;
   - list rows (icon, title, subtitle, chevron), cards;
   - toggles/switches, segmented controls and tabs;
   - badges and counts, avatars, chips, menus/popovers;
   - empty, loading and error states, section labels, page headers with back.
   Use `rg` counts, and say how you counted.
2. **Proposed kit:** one table per app. Columns: component name (same names on web and mobile), props API sketch, D24 recipe it uses, which current duplicates it replaces, priority (P1 = used in 5+ places).
3. **Shared tokens package proposal:** a new `packages/ui-tokens` (name it) exporting colours, radii, spacing and the depth recipes as plain data. Explain how web (CSS variables or Tailwind theme) and mobile (nativewind config plus `depth.ts`) would consume it. List every token that differs today between `index.css`, `global.css` and `colors.ts`, with values.
4. **React Cosmos plan:** read the official docs (cosmos.js.org) and the package metadata on npm (use web search or `pnpm view react-cosmos versions` and `pnpm view react-cosmos-native`; do not install anything).
   - Web: the current React Cosmos version for Vite, the setup files, and where fixtures live (`*.fixture.tsx` next to the component).
   - Mobile: how Cosmos runs with React Native/Expo. Cover the native renderer, whether it supports Expo 57 / RN 0.86 / nativewind 4 / expo-router (say plainly where support is unknown or missing), and the fallback if it does not work: run the RN kit through `react-native-web` inside the web Cosmos, or a Cosmos-like catalog screen under `apps/mobile/src/app/dev/`.
   - How fixtures must stay out of the app bundle. Note `apps/mobile/src/lib/routes-dir.test.ts` forbids test files under `src/app`.
   - How the gate (`pnpm gate`) could check that fixtures build.
5. **Migration plan:** ordered small tasks (tokens package; web kit P1 + Cosmos; mobile kit P1 + Cosmos or fallback; then one migration task per area: settings pages, chat list, dialogs, AI screens…). For each task: Allowed files and the duplicates it removes. Add a gate check proposal that flags new hand-rolled accent buttons (e.g. a grep rule for `bg-accent px-` outside `components/ui`).
6. **Risks:** visual regressions; merges with running tasks (T-0227 composer, T-0233 bottom bar, T-0232/T-0235); how to verify (Cosmos snapshots or screenshots, emulator QA).

### Read first
`AGENTS.md`, `docs/design/ui-style.md`, `apps/web/src/components/ui/button.tsx`, `apps/web/src/index.css` (lines 1-300), `apps/mobile/src/components/ui/button.tsx`, `apps/mobile/src/lib/depth.ts`, `apps/mobile/src/global.css`, `apps/mobile/src/lib/colors.ts`.

### Allowed files
`docs/audit/ui-kit-audit.md` (new), `work/T-0236-ui-kit-audit.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- Every claim in the audit has a `file:line` or a command and its output; React Cosmos support for Expo/RN is stated with sources (URLs, versions), and unknowns are marked as unknown.
- No code, config or package change; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Writing any component, installing Cosmos, changing tokens.

---

## Report (written by the worker when done)

## Review (written by Claude)
