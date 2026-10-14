---
id: T-1342
title: "Audit: find every hand-rolled UI piece on mobile and web that a mature library or a native component does better (like the photo viewer, now on react-native-zoom-toolkit); write docs/audit/library-plan.md with one ranked row per swap"
status: merged
milestone: M5
branch: task/T-1342-library-audit
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1342: Library audit

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13: hand-rolled photo viewer gestures failed twice on his Android phone (T-1338). The library swap (T-1341, `react-native-zoom-toolkit` Gallery) was "perfect" on the first try. He asked: "can we do the same with similar components where we have made things where we can use a library or something native?"

### What to do (read-only audit; no code changes)
1. **Look** through `apps/mobile/src` and `apps/web/src` (and `packages/*` UI code) for hand-rolled code that re-implements something a mature library or the platform does natively. Candidates to check (not exhaustive):
   - **gestures:** swipe-to-reply, swipe actions on list rows, long-press menus, pull-to-refresh, drag-to-reorder;
   - **sheets and menus:** bottom sheets and modals, context menus (native menus via `zeego` / `@react-native-menu/menu`, or Expo's native components);
   - **lists:** the chat list and message list virtualization (`@shopify/flash-list` / `@legendapp/list` on mobile, `@tanstack/react-virtual` on web);
   - **keyboard handling:** keyboard-avoiding composer (`react-native-keyboard-controller`);
   - **media:** video and audio players, voice recording waveform, image picker or cropper, the web media viewer (T-1339/T-1340 hand-rolled zoom; candidates like `yet-another-react-lightbox` or `react-zoom-pan-pinch`);
   - **text and pickers:** date/time formatting, emoji picker, markdown rendering, toasts, link previews, file pickers;
   - **web UI:** web dialogs, popovers, tooltips and focus traps (does web already use Radix or Base UI? check `apps/web/package.json`).
2. **For each hand-rolled piece**, record:
   - file paths with line counts;
   - what it does;
   - known bugs or fragility (git log `fix` commits touching it, open notes in `work/` or `docs/audit/`);
   - the candidate library or native API;
   - checks on the library: latest version, last publish date (`npm view <pkg> time.modified`), peer deps. It must work with **Expo SDK / React Native new architecture, reanimated 4.5.1, RNGH ~2.32** (`apps/mobile/package.json`), and on web with React 19 / Vite;
   - lines deleted versus added (an estimate);
   - risk;
   - parity: web, Android and iOS.
3. **Rank** the rows by user-visible benefit ÷ effort. Mark "keep hand-rolled" where a library would be worse, and say why. Skip anything already on a library.
4. **Write** `docs/audit/library-plan.md`: a summary table first, then one section per row, written so a follow-up spec can cite `file:line` straight from it. Group the rows into proposed tasks (at most one library per task, web and mobile twins named).

### Read first
`AGENTS.md`, `apps/mobile/package.json`, `apps/web/package.json`, `work/T-1341-viewer-zoom-toolkit.md`, `docs/audit/mobile-ux-audit.md`.

### Allowed files
`docs/audit/library-plan.md`, `work/T-1342-library-audit.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- `docs/audit/library-plan.md` exists, with a ranked table and verified npm facts (version, date and peers taken from `npm view`, not memory).
- The gate passes.

---

## Report (written by the worker when done)

Status: review.

### What I did
Read-only audit as specified; no code changed. I walked `apps/mobile/src`,
`apps/web/src` and the shared UI code for hand-rolled pieces that a mature
library or the platform does better, and wrote `docs/audit/library-plan.md`:
a ranked summary table, one section per row (files + line counts, what it does,
known bugs/fragility with git-log evidence, the candidate library, `npm view`
facts, lines removed/added, risk, parity), a "keep hand-rolled" section, and
proposed tasks grouped one library per task with web/mobile twins named.

Ranked rows (benefit ÷ effort): (1) mobile photo viewer → `react-native-zoom-toolkit`
[= T-1341]; (2) web photo viewer → `yet-another-react-lightbox`; (3) web
dialogs/menus/focus trap → Radix (already a dependency); (4) mobile keyboard →
`react-native-keyboard-controller`; (5) web lists → `@tanstack/react-virtual`;
(6) mobile markdown → `@ronradtke/react-native-markdown-display`; (7) mobile
bottom sheets → `@gorhom/bottom-sheet`; (8) mobile lists → `@shopify/flash-list`
(marked **keep FlatList for now**); (9) web cropper → `react-easy-crop`;
(10) web reorder → `@dnd-kit/core`.

### Files changed
- `docs/audit/library-plan.md` (new) — the audit and plan.
- `work/T-1342-library-audit.md` — this Report + status.

### npm facts (checked with `npm view <pkg> version time.modified peerDependencies`, 2026-10-13)
- `react-native-zoom-toolkit` 5.1.1, 2026-08-30 — peers `react *`, `react-native *`.
- `yet-another-react-lightbox` 3.32.2, 2026-07-30 — peers `react`/`react-dom` `^16.8‖^17‖^18‖^19`.
- `radix-ui` 1.8.1, 2026-10-13; `@radix-ui/react-dialog` 1.3.1, 2026-10-13; `@radix-ui/react-dropdown-menu` 2.2.1, 2026-10-13 — React 19 peers. Installed umbrella is 1.6.7.
- `react-native-keyboard-controller` 1.22.7, 2026-10-12 — peers `reanimated >=3.0.0`.
- `@tanstack/react-virtual` 3.14.19, 2026-10-13 — peers `react`/`react-dom` `^19`.
- `@ronradtke/react-native-markdown-display` 9.0.3, 2026-06-29 — peers `react >=16.2.0`, `react-native >=0.50.4` (original `react-native-markdown-display` 7.0.2 is 2023-12-11).
- `@gorhom/bottom-sheet` 5.2.14, 2026-05-09 — peers `gesture-handler >=2.16.1`, `reanimated >=3.16.0‖>=4.0.0-`.
- `@shopify/flash-list` 2.3.3, 2026-10-01; `@legendapp/list` 3.6.0, 2026-09-29.
- `react-easy-crop` 6.2.4, 2026-10-06; `@dnd-kit/core` 6.3.1, 2024-12-05.
- Kept-hand-rolled, for the record: `sonner` 2.0.8 (2026-08-09), `rn-emoji-keyboard` 1.7.0 (2024-05-09), `@react-native-menu/menu` 2.0.0 (2025-09-10), `zeego` 3.0.6 (2025-03-21).

### Commands run (real results)
- `pnpm install` — done in 12.8s; 1183 packages; one existing peer warning (`@types/react-dom` vs `@types/react`) unrelated to this task.
- `pnpm gate` (from repo root) — see the summary below: install/format/lint/typecheck all PASS, effect SKIP (no source files changed), scope OK, migrations OK, ending in `GATE PASS`. The two changed files are exactly the Allowed files.
- Single tests: **none** — this task changes docs only and touches no code, so per AGENTS.md there is nothing to test; `pnpm gate` ran the package checks (effect step skipped itself because no source files changed).

### Gate summary lines (verbatim)
```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.1s)
PASS  lint  (1.0s)
PASS  typecheck  (1.2s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Problems / deviations
- None that block. Deviations from a literal reading of the spec, all deliberate:
  - The spec's candidate list is "not exhaustive"; I checked every item it named
    and added the mobile/desktop twins, but I did not file a row for things
    already on a library/platform (swipe rows → RNGH `ReanimatedSwipeable`,
    pickers → Expo, players → `expo-video`/`expo-audio`/native `<audio>`,
    date/money → `Intl`). They are recorded in §3 as "already a library".
  - Rows 7 and 8 are ranked below the high-benefit swaps because a sheet
    migration touches ~20 call sites (high effort) and FlashList's gain is
    performance-only against a scroll model that took several rounds to stabilise
    — I marked Row 8 explicitly **"keep FlatList for now"**.

### Blocked / needs a decision
Nothing blocked. Open question for the lead: whether the web photo viewer (Row 2)
should land as its own task now (twin of T-1341) or wait until T-1341 is merged
and Julio has smoke-tested the mobile library choice — the plan lists it as a
standalone task either way.

### Round (fix round 1)

Findings fixed:
- **Finding 1** (should-fix): `ask/[id].tsx:254` → `ais/[id].tsx:254`. Verified:
  `apps/mobile/src/app/ask` does not exist and `grep` finds the
  `KeyboardAvoidingView` usage at `apps/mobile/src/app/ais/[id].tsx:254`.
- **Finding 2** (should-fix): added the missing `components/` prefix,
  `settings/avatar-native.ts:152-161` → `components/settings/avatar-native.ts:152-161`.
  Verified: `apps/mobile/src/components/settings/avatar-native.ts:161` has
  `allowsEditing: true`.

Findings not fixed: 3 and 4 (both nits, `BottomSheet`/`ActionSheet` and
`KeyboardAvoidingView` counts). Left untouched as instructed: neither sits on a
line this round changed.

Tests added: none — this is a docs-only task; no code or test file was touched,
so per AGENTS.md the only check is the gate.

Gate (from the repo root, verbatim summary):
```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (0.8s)
PASS  lint  (1.2s)
PASS  typecheck  (1.5s)
SKIP effect (no source files changed)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean after 1 auto round (2 count nits); the packet is current for `91d86eb2`.**
- Wave 1 is launched from this plan: T-1343 (row 2), T-1344 (row 3, Dialog/Sheet only; Menu needs its own plan), T-1345 (row 4), T-1346 (row 9) and T-1347 (row 10).
- Rows 5, 6 and 7 wait for wave 2; row 8 stays a note.
