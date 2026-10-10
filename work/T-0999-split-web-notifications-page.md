---
id: T-0999
title: "Size split T67: apps/web/src/routes/NotificationsPage.tsx (551 lines) into lib/push/{deviceStorage,pageActions,usePushEnable} and components/push/{ThisDeviceCard,DevicesSection,PreviewsSection}"
status: merged
milestone: M5
branch: task/T-0999-split-web-notifications-page
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-0999: Split `NotificationsPage.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/routes/NotificationsPage.tsx` is 551 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #63 (task T67). The new files go in two new folders under `apps/web/src/`:
- `lib/push/`: `deviceStorage.ts`, `pageActions.ts`, `usePushEnable.ts`;
- `components/push/`: `ThisDeviceCard.tsx`, `DevicesSection.tsx`, `PreviewsSection.tsx`.

The page keeps every export it has today.

- **Skip the Dedup:** moving `attempt`/`quietly`/`runPageAction` to the shared `lib/effect` crosses files. They go to `lib/push/pageActions.ts` unchanged.
- **The push secrets:** the subscription and its keys are handled exactly as now.

The lead checks the page in Chrome in mock mode.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #63, and `apps/web/src/routes/NotificationsPage.tsx`.

### Allowed files
`apps/web/src/routes/NotificationsPage.tsx`, `apps/web/src/lib/push/deviceStorage.ts`, `apps/web/src/lib/push/pageActions.ts`, `apps/web/src/lib/push/usePushEnable.ts`, `apps/web/src/components/push/ThisDeviceCard.tsx`, `apps/web/src/components/push/DevicesSection.tsx`, `apps/web/src/components/push/PreviewsSection.tsx`, `work/T-0999-split-web-notifications-page.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, the Report has everything `split-rules.md` item 8 asks for, and the Report names the page's route.

---

## Report (written by the worker when done)

### What I did

Split `apps/web/src/routes/NotificationsPage.tsx` (551 lines on main) into the six new
files named by `docs/audit/size-plan.md` §2.2 #63, moving the code unchanged. The page
stays the route module and keeps its only export, `NotificationsPage`, so no importer
changed (`apps/web/src/routes/AppRoutes.tsx` still lazily imports `./NotificationsPage`
and reads `m.NotificationsPage`).

The page's route is **`/settings/notifications`** (child of the settings shell,
`RequireAuth`-wrapped) — `apps/web/src/routes/AppRoutes.tsx:178`.

- `lib/push/deviceStorage.ts`: `DEVICE_KEY`, `StoredDevice`, `decodeStoredDevice`,
  `readStoredDevice`, `writeStoredDevice` (old lines 39–72).
- `lib/push/pageActions.ts`: `attempt`, `quietly`, `runPageAction`,
  `withPermissionAnswer`, `friendlyError` (old lines 74–140).
- `lib/push/usePushEnable.ts`: `PageStatus` + the page's state and actions, now a hook
  `usePushEnable()` (old lines 142–366).
- `components/push/ThisDeviceCard.tsx`: the "This device" card (old lines 444–472).
- `components/push/DevicesSection.tsx`: the devices list (old lines 473–507).
- `components/push/PreviewsSection.tsx`: the previews toggle (old lines 508–522).

The page keeps every export it had today (only `NotificationsPage`). The `attempt`/
`quietly`/`runPageAction` **Dedup** was skipped on purpose, per the task: they go to
`lib/push/pageActions.ts` unchanged. The push secrets (endpoint + keys) are handled
exactly as before; that code moved unchanged into `usePushEnable.ts`.

### Sizes (`wc -l`)

| file | lines |
| --- | --- |
| `apps/web/src/routes/NotificationsPage.tsx` (was 551) | 150 |
| `apps/web/src/lib/push/deviceStorage.ts` | 39 |
| `apps/web/src/lib/push/pageActions.ts` | 74 |
| `apps/web/src/lib/push/usePushEnable.ts` | 294 |
| `apps/web/src/components/push/ThisDeviceCard.tsx` | 45 |
| `apps/web/src/components/push/DevicesSection.tsx` | 51 |
| `apps/web/src/components/push/PreviewsSection.tsx` | 29 |

Every file is at most 400 lines.

### Export list before → after (`grep -E "^export"`)

Before (`git show main:apps/web/src/routes/NotificationsPage.tsx`):

```
export function NotificationsPage() {
```

After (page + the new files):

```
apps/web/src/routes/NotificationsPage.tsx: export function NotificationsPage() {
apps/web/src/lib/push/deviceStorage.ts: export interface StoredDevice {
apps/web/src/lib/push/deviceStorage.ts: export function readStoredDevice(): StoredDevice | null {
apps/web/src/lib/push/deviceStorage.ts: export function writeStoredDevice(device: StoredDevice | null): void {
apps/web/src/lib/push/pageActions.ts: export function attempt<A>(run: () => Promise<A>): Effect.Effect<A, unknown> {
apps/web/src/lib/push/pageActions.ts: export function quietly<A>(effect: Effect.Effect<A, unknown>): Effect.Effect<void> {
apps/web/src/lib/push/pageActions.ts: export function runPageAction(
apps/web/src/lib/push/pageActions.ts: export function withPermissionAnswer(
apps/web/src/lib/push/pageActions.ts: export function friendlyError(error: unknown): string {
apps/web/src/lib/push/usePushEnable.ts: export interface PushEnable {
apps/web/src/lib/push/usePushEnable.ts: export function usePushEnable(): PushEnable {
apps/web/src/components/push/ThisDeviceCard.tsx: export function ThisDeviceCard({
apps/web/src/components/push/DevicesSection.tsx: export function DevicesSection({
apps/web/src/components/push/PreviewsSection.tsx: export function PreviewsSection({
```

The only name any external file imports, `NotificationsPage`, is unchanged. No file
outside the task's own files was edited.

### Effect ratchet (`// effect-plain:` markers)

No marker was needed and none was added. `deviceStorage.ts`, `pageActions.ts` and
`usePushEnable.ts` import `effect` as a value, so the map classifies them `effect`;
`ThisDeviceCard.tsx`, `DevicesSection.tsx` and `PreviewsSection.tsx` have no signals,
so they classify `plain`. The gate's `effect` step passed.

### Commands run (real results)

- `pnpm install` — done (pnpm v10.32.1, 20.3s).
- `pnpm --filter @zilar/web build` — succeeded: `✓ built in 872ms`
  (`dist/assets/NotificationsPage-lwnZHPAZ.js 9.93 kB`).
- `pnpm gate` (from repo root) — **GATE PASS**:

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (2.0s)
PASS  format  (1.0s)
PASS  lint  (1.1s)
PASS  typecheck  (4.4s)
PASS  effect  (1.6s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

The first gate run failed only on `format` for `DevicesSection.tsx`; I formatted that one
file with `pnpm exec prettier --write` and the re-run passed. No single test file was run:
there are no tests near this page (`grep` found none importing `NotificationsPage` or
`lib/push`), and the gate skipped the web tests for the same reason.

### Deviations / notes

- None from the spec. The cross-file **Dedup** (move `attempt`/`quietly`/`runPageAction`
  to shared `lib/effect`) was deliberately skipped, as the task says.
- `lib/push.ts` (the browser push module) is untouched: the new `lib/push/` folder has no
  `index.ts`, so `@/lib/push` still resolves to `lib/push.ts` exactly as before.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `NotificationsPage.tsx` (551 lines) is now 150 lines, plus `lib/push/{deviceStorage,pageActions,usePushEnable}` (the largest 294) and `components/push/{ThisDeviceCard,DevicesSection,PreviewsSection}`.
- **The lead checked it in Chrome on `/settings/notifications?mock=1`:**
  - This device (Not enabled, with "Enable on this device"), Devices ("No devices yet"), Message previews and Test all render;
  - the previews toggle flips off and back on.
- **Not pressed:** "Enable on this device", because it opens the browser permission prompt.
- **Check:** the gate passed, and so did the web build.
