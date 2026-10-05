---
id: T-0247
title: "Mobile: Settings hub redesign (grouped cards, monochrome icon tiles, header) plus a Blocked people row and the tab header padding"
status: merged
milestone: M5
branch: task/T-0247-mobile-settings-hub
model: deepseek/deepseek-flash
effort: default
depends_on: [T-0233, T-0244]
estimate: 0.5 day
---

# T-0247: Mobile Settings hub, Telegram-style

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-05: take a look at the Settings and Profile screens. Brief `docs/design/briefs/telegram-nav-folders-settings.md` section c plus "Decisions" 1 (monochrome D24 keys, no colours) and 5 (My AIs is a tab, not a Settings row). Mockup: `docs/design/briefs/telegram-nav-folders-settings.html` v3 (mobile Settings frame).

QA run 5 found that the AIs and Settings tab headers sit about 18 px from the screen edge, against about 36 px elsewhere. T-0244 added the Blocked people screen (`/settings/blocked`).

### Verified facts (do not re-derive)
- The tab screen is `apps/mobile/src/app/(tabs)/settings.tsx` (151 lines):
  - `HUB_ICONS` (lines 40-48);
  - `UserCard` (lines 55-75: avatar 52, name, `@handle` or email, in a bordered surface row);
  - `SettingsRow` (lines 77-97, a bordered surface `Pressable` per row);
  - `SettingsHub` (lines 100-151; subtitle "Your profile and your AIs." at line 134, stale since My AIs left).
- Rows come from `SETTINGS_ITEMS` (`apps/mobile/src/lib/settings-items.ts`: profile, requests, approvals, machines, connections, integrations, stickers; the `ais` row is gone). They are mapped by `settingsHubRows` (`apps/mobile/src/components/settings/hub.ts` lines 20-30). The test is `apps/mobile/src/lib/settings-items.test.ts`. `.gitattributes` merges `settings-items.ts` with `merge=union`.
- The header padding is `px-2` in both shells: `apps/mobile/src/components/settings/screen-shell.tsx` line 32 and `apps/mobile/src/components/ais/screen-shell.tsx` line 38.
- Depth recipes for tiles: `apps/mobile/src/lib/depth.ts` (icon key `KEY_ICON_*`), `apps/mobile/src/components/ui/icon-button.tsx`. Colours: `apps/mobile/src/lib/colors.ts` (`ICON`).

### What to build
1. **Groups:** add `group: 'account' | 'ais' | 'chats' | 'server'` to `SettingsItemShape`, a row `blocked` (title "Blocked people", subtitle "People you blocked. They are not told.", icon `blocked` (lucide `Ban`), href `/settings/blocked`, group `account`), and pass `group` through `settingsHubRows`. Groups and order:
   - Account: Profile, Contact requests, Blocked people.
   - AIs and tools: Approvals, Machines, Connections.
   - Chats: Stickers.
   - Server: Integrations.
2. **Hub layout** in `(tabs)/settings.tsx`:
   - a header card with avatar 64, name 18/600 and `@handle` (or email while unclaimed). Tapping it opens `/settings/profile`.
   - then one card per group (`bg-surface rounded-2xl border-border`, with hairline dividers between rows), each under an uppercase muted group label (11/600, letter-spacing).
   - rows: a 34x34 monochrome icon tile (dark key look from `depth.ts`, radius 10, foreground icon), the title, a one-line muted subtitle and a lucide `ChevronRight`.
   - the Contact requests row shows the pending count as a small pill when greater than 0 (use the same source the requests screen uses for its count).
   - subtitle "Your account, chats and AIs.".
3. **Header padding:** `px-4` on the title row of both shells when there is no back button; keep `px-2` when there is one (the back key brings its own spacing).
4. **Tests:**
   - `settings-items.test.ts`: every item has a group and the group order is right; `blocked` is present and `ais` is absent.
   - the hub rows test (`apps/mobile/src/components/settings/hub.test.ts` if it exists, else new): rows grouped in order.
   - a shell test covering the padding switch.
   (Tests may not live under `src/app`; see `apps/mobile/src/lib/routes-dir.test.ts`.)

### Read first
`AGENTS.md`, `docs/design/briefs/telegram-nav-folders-settings.md` (sections c and Decisions), `apps/mobile/src/app/(tabs)/settings.tsx`, `apps/mobile/src/lib/settings-items.ts`, `apps/mobile/src/components/settings/hub.ts`, `apps/mobile/src/components/settings/screen-shell.tsx`, `apps/mobile/src/lib/depth.ts`.

### Allowed files
`apps/mobile/src/app/(tabs)/settings.tsx`, `apps/mobile/src/lib/settings-items.ts`, `apps/mobile/src/lib/settings-items.test.ts`, `apps/mobile/src/components/settings/**`, `apps/mobile/src/components/ais/screen-shell.tsx`, `work/T-0247-mobile-settings-hub.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot settings-items hub screen-shell
pnpm gate
```

### Acceptance
- The Settings tab shows the header card and four grouped cards with monochrome icon tiles. Blocked people is reachable from the hub. Tab headers have the same side padding as the rest of the app.
- Lucide icons only, no emoji, no colour tints. No server or web change.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Chat folders row (comes with mobile folders), Notifications and other "later" rows, restyling `settings/profile.tsx`.

---

## Report (written by the worker when done)

### What I did
- `settings-items.ts`: added the `SettingsGroup` type and `SETTINGS_GROUP_ORDER`; added `group` to `SettingsItemShape` and to every existing row; appended the `blocked` row (title "Blocked people", subtitle "People you blocked. They are not told.", icon `blocked`, href `/settings/blocked`, group `account`). The array stays append-only and the `ais` row stays gone.
- `hub.ts`: added `group` to `SettingsHubRow`, added `SettingsHubGroup` and `SETTINGS_GROUP_LABELS`, made `settingsHubRows()` return the rows grouped in account → ais → chats → server order, and added `settingsHubGroups()` (one card per group).
- `(tabs)/settings.tsx`: mapped `HUB_ICONS.blocked = Ban`; the header card (avatar 64, name 18/600, `@handle` or email) opens `/settings/profile`; one card per group under an uppercase 11/600 label; rows use a 34×34 `iconKey` tile (radius 10, `ICON` glyph), title, one-line muted subtitle and a `ChevronRight`; the Contact requests row shows a pill with the pending count from the same source the requests screen uses (`listContactRequests()`, incoming + outgoing); subtitle is now "Your account, chats and AIs.".
- Both screen shells: the title row is `px-4` when there is no back key and `px-2` when there is one (the back key brings its own spacing).
- Tests: extended `settings-items.test.ts` and `hub.test.ts`, added `screen-shell.test.tsx` covering the padding switch for both shells.

### Files changed
- `apps/mobile/src/app/(tabs)/settings.tsx`
- `apps/mobile/src/lib/settings-items.ts`
- `apps/mobile/src/lib/settings-items.test.ts`
- `apps/mobile/src/components/settings/hub.ts`
- `apps/mobile/src/components/settings/hub.test.ts`
- `apps/mobile/src/components/settings/screen-shell.tsx`
- `apps/mobile/src/components/settings/screen-shell.test.tsx` (new)
- `apps/mobile/src/components/ais/screen-shell.tsx`
- `work/T-0247-mobile-settings-hub.md`

### Commands run (real results)
- `pnpm install` (start): exit 0, "Done in 15s". It appended 2 peer-metadata lines to `pnpm-lock.yaml`; I reverted that incidental change, and the gate's frozen install still passes.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot settings-items hub screen-shell`: 3 files, 10 tests passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot screen-shell` (after the lint fix): 1 file, 2 tests passed.
- `pnpm gate` (repo root): first run ended `GATE FAIL` on lint — `react(no-children-prop)` in the new shell test; I passed children as JSX children and re-ran. The final run on the committed tree:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (18.2s)
  PASS  lint  (0.7s)
  PASS  typecheck  (0.6s)
  PASS  tests @zilar/mobile  (2.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations and notes
- The spec says "foreground icon" on the tile; I used the existing icon-key glyph colour `ICON` (`#d4d4d4`), which is what the mockup's `.key` (`--soft`) and `IconButton` use. Say if `foreground` (`#ededed`) is preferred and I will switch it.
- If the pending-count fetch fails, the hub simply shows no pill (count 0); the failure is not surfaced on the hub, matching the optimistic `UserCard` behaviour for a profile fetch failure.
- Group labels live in `hub.ts` (presentation); the registry only owns the `group` value.

### Open questions
None blocking.

### Security checklist
No new network writes, logs or secrets; the hub only calls the existing read APIs (`getMe`, `listContactRequests`).

## Review (written by Claude)

**Verdict:** Approved; the first pre-review was clean (2 nits) and the task ran on DeepSeek flash.
- The groups have the brief's order, `blocked` is in Account, and the `ais` row is gone.
- The tile glyph uses `ICON` (#d4d4d4), like `IconButton`, which is accepted.
- The pending count matches the requests screen (incoming plus outgoing).
- Both shells use `px-4` without a back button.

The emulator look is in QA run 6, together with T-0244's blocking screens.
