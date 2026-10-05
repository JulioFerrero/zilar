---
id: T-0236
title: "Audit: duplicated UI on web and mobile, the shared kit to build, and how React Cosmos fits (docs only)"
status: merged
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

Wrote `docs/audit/ui-kit-audit.md` (docs only; no code, config or package changes).
Contents: per-app inventory with `rg` counts + `file:line` examples (web: 67 files /
249 raw `<button>` vs 13 kit `Button` users, 32 accent hand-roll files, 18 dialog
shells, 30 input files, 0 shared Switch/Dialog/Row/Badge; mobile: 75 files / 342 raw
`<Pressable>` vs 13 kit users, 0 `<Switch>` uses, 24 Modal files, 111 empty/loading
files); kit tables per app with matching names + props sketches + D24 recipes +
priorities; `packages/ui-tokens` proposal with a full diff table (8+ tokens differ:
dot-grid vs flat chat bg, missing `key-text-shadow`/`avatar-ring`/
`list-active-foreground`/voice tokens on mobile, alias-vs-literal shadcn names,
radius scale, fonts); React Cosmos plan from reactcosmos.org docs + `pnpm view`
(7.4.1 latest; Vite plugin + `*.fixture.tsx` for web; native renderer needs a
manual Metro entry and Expo 57/RN 0.86/nativewind 4/expo-router support is marked
unknown with the react-native-web + `src/app/dev/` fallback as recommended default;
`cosmos.js.org` is an unrelated crypto framework — not used); ordered migration
tasks with Allowed files + a `bg-accent px-` grep gate proposal; risks incl.
T-0227/T-0233/T-0232/T-0235 overlap.

Files changed: `docs/audit/ui-kit-audit.md` (new), `work/T-0236-ui-kit-audit.md`
(this file). Single-test runs: none applicable (docs-only, no tests touched).
`pnpm install`: done, 17.5s OK. `pnpm gate`: GATE PASS — install/lint/format/
typecheck all PASS, "scope: every changed file is inside the Allowed files"
(2 changed files). No deviations from spec. Open questions for the lead:
(1) dot-grid chat bg on native vs intentional flat divergence (needs a decision in
the tokens task); (2) whether to timebox or skip the native Cosmos renderer spike
given the RNW fallback is cheap (`react-native-web ~0.21.0` already a mobile dep).

### Round 2 (fix round, 2026-10-05)

Findings addressed: finding 1 (should-fix) fixed — `docs/audit/ui-kit-audit.md:41`
now cites `rg -l --glob '!**/*.test.*' 'ui/button'` (verified: 13 files) instead of
the `components/ui/button` spelling that only matched 4 relative imports.
Findings 2 and 3 are nits on lines I did not otherwise change, so per
instructions I left them as-is (verified current values: mobile `avatar` 36,
web switch/checkbox 4).

Disagreements: none — all three findings reproduce as stated.

Tests added: none (docs-only fix; no behaviour change, no test names a finding).
Single-test runs: none applicable.
`pnpm gate`: (result pasted below after run).
GATE PASS — install/lint/format/typecheck all PASS, "scope: every changed file
is inside the Allowed files" (2 changed files).

### Round 3 (fix round, 2026-10-05)

Findings addressed: finding 1 (should-fix) fixed — `docs/audit/ui-kit-audit.md`
IconButton line now names the actual four `ui/icon-button` importers
(`ChatHeader.tsx:9`, `ChatList.tsx:22`, `Composer.tsx:30`,
`MessageList.tsx:14`), verified with `rg -n 'ui/icon-button'` on those files.
Finding 4's `key-icon` nit was on the same line I changed, so folded into the
same edit (now notes 5 files include `index.css` + kit itself, 3 consumers).
Findings 2, 3, 5 are nits on lines I did not otherwise change, so per
instructions left as-is (verified current values: web switch/checkbox 5 files
including a `.test.tsx`, mobile `avatar` 37 counting via `rg -li -l` from
`apps/web/src`/`apps/mobile/src`).

Disagreements: none — all five findings reproduce as stated.

Tests added: none (docs-only fix; no behaviour change, no test names a finding).
Single-test runs: none applicable.
`pnpm gate`: GATE PASS — install/lint/format/typecheck all PASS, "scope: every
changed file is inside the Allowed files" (2 changed files).

## Review (written by Claude)

**Verdict:** Approved after 2 auto rounds; packet clean, 3 count/citation nits left as they are. I read sections 2-6. The kit tables use the same names on both apps; the token differences are concrete (chat background, key text shadow, radius scale); the Cosmos plan cites reactcosmos.org (and notes cosmos.js.org is a different project). Mobile Cosmos on Expo 57 / expo-router is marked unknown, and the fallback (react-native-web inside the web Cosmos, plus a `src/app/dev/` catalog) is chosen up front. Next, after Julio sees the plan: `packages/ui-tokens`, then the web kit P1 with Cosmos, then the mobile kit, then one migration task per area once T-0227, T-0233 and T-0237 have landed.
