---
id: T-1009
title: "Size split T84: apps/web/src/components/ChatList.tsx (509 lines) into components/chatList/{rowsSelector,ChatListMenu,ChatListBody}; one NavMenuItem"
status: merged
milestone: M5
branch: task/T-1009-split-web-chat-list
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1009: Split `ChatList.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/ChatList.tsx` is 509 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #80 (task T84). The new files go in a new `apps/web/src/components/chatList/` folder: `rowsSelector.ts`, `ChatListMenu.tsx` and `ChatListBody.tsx`. `ChatList.tsx` keeps the list and every export it has today.

The in-file Dedup is in scope: the menu's near-identical "close the menu, then navigate" items become one `NavMenuItem({ to, label, badge })`. Each item keeps its own label, target and badge, and the order stays the same.

The lead checks it in Chrome in mock mode: the chat list, the ☰ menu and each of its links.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #80, and `apps/web/src/components/ChatList.tsx`.

### Allowed files
`apps/web/src/components/ChatList.tsx`, `apps/web/src/components/chatList/rowsSelector.ts`, `apps/web/src/components/chatList/ChatListMenu.tsx`, `apps/web/src/components/chatList/ChatListBody.tsx`, `work/T-1009-split-web-chat-list.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for, plus the menu items' labels and targets before and after.

---

## Report (written by the worker when done)

### What I did

Split `apps/web/src/components/ChatList.tsx` (509 lines on the base) into the three files the plan entry §2.2 #80 names, leaving `ChatList.tsx` as the barrel (it still exports only `ChatList`) plus the header, connection banner, folder tabs and the four overlays. Importers do not change: the only importer, `apps/web/src/routes/ChatShell.tsx`, still imports `{ ChatList } from '@/components/ChatList'`.

- `components/chatList/rowsSelector.ts` — moved unchanged: `CONNECTION_BANNER_DELAY_MS`, `APPROVAL_BADGE_CAP`, `InstallFailed`, the `ChatRows` interface, `createRowsSelector`, `statusLabel` (the plan's 39–104 range).
- `components/chatList/ChatListMenu.tsx` — the `☰` button plus the `Menu` (the plan's 189–350 range), now the `ChatListMenu` component.
- `components/chatList/ChatListBody.tsx` — the `<nav>` list body (the plan's 376–500 range), now the `ChatListBody` component.

**Dedup (in scope, as specced).** The eleven near-identical `<MenuItem onSelect={() => { setMenuOpen(false); navigate(...) }}>` blocks collapse into one `NavMenuItem({ to, label, badge })` (module-private in `ChatListMenu.tsx`). Each item keeps its own label, target and badge, in the same order. Because a child component cannot otherwise close the parent's menu, `NavMenuItem` reads the close callback from a small `MenuCloseContext` provider that `ChatListMenu` sets, so the public call site stays `{ to, label, badge }` as the spec asks. The two dialog items (Invite a friend, Explore groups), the conditional Install item and the destructive Sign out item stay as plain `MenuItem`s (they are not "close, then navigate" items); their bodies are unchanged apart from reading `close()`/callbacks from props.

**No behaviour change.** The menu's hooks (`useIsServerOwner`, `usePendingApprovalCount(menuOpen)`, `useContactRequestCount(true)`, `useInstallPrompt`, `useAction`) stay in `ChatList.tsx` (they are outside the moved JSX ranges) and are passed to `ChatListMenu` as props, so their component lifetimes are unchanged (e.g. the approval/contact badges do not refetch on a width change). The install click still runs `promptInstall()` synchronously inside the click and is still guarded by `isWaiting(installState)`.

### Menu items: labels and targets before → after

Order is unchanged in both.

| # | label | target / action before | after |
|---|-------|------------------------|-------|
| 1 | Invite a friend | `setMenuOpen(false); setInviteOpen(true)` | `close(); onInvite()` |
| 2 | Requests | `/settings/requests` + `incomingRequests` badge | same (`NavMenuItem`, same badge) |
| 3 | Chat folders | `/settings/folders` | same (`NavMenuItem`) |
| 4 | Blocked people | `/settings/blocked` | same (`NavMenuItem`) |
| 5 | Explore groups | `setMenuOpen(false); setExploreOpen(true)` | `close(); onExplore()` |
| 6 | Profile | `/settings/profile` | same (`NavMenuItem`) |
| 7 | Connections | `/settings/connections` | same (`NavMenuItem`) |
| 8 | Machines | `/settings/machines` | same (`NavMenuItem`) |
| 9 | Approvals | `/settings/approvals` + `approvalsBadge` badge | same (`NavMenuItem`, same badge) |
| 10 | My AIs | `/settings/ais` | same (`NavMenuItem`) |
| 11 | Notifications | `/settings/notifications` | same (`NavMenuItem`) |
| 12 | Install app (`installEvent !== null`) | `runInstall(promptInstall())` if not waiting; label "Install failed — try again" on failure | `close(); if (!installing) onInstall()`; same label |
| 13 | Stickers | `/settings/stickers` | same (`NavMenuItem`) |
| 14 | Integrations (`isServerOwner`) | `/settings/integrations` | same (`NavMenuItem`) |
| 15 | Sign out (destructive) | `signOut` (closes menu + `storeApi.signOut()`) | same (`onSignOut`) |

### Sizes (`wc -l`, after the split)

- old `apps/web/src/components/ChatList.tsx`: **509**
- `apps/web/src/components/ChatList.tsx` (barrel): **187**
- `apps/web/src/components/chatList/rowsSelector.ts`: **69**
- `apps/web/src/components/chatList/ChatListMenu.tsx`: **167**
- `apps/web/src/components/chatList/ChatListBody.tsx`: **180**

All at most 400.

### Export list before → after (`grep -E "^export"`)

Before (base `ChatList.tsx`):

```
export function ChatList({ activeChatId }: { activeChatId: string | undefined }) {
```

After (`ChatList.tsx` barrel + the new files):

```
# apps/web/src/components/ChatList.tsx
export function ChatList({ activeChatId }: { activeChatId: string | undefined }) {
# apps/web/src/components/chatList/rowsSelector.ts
export const CONNECTION_BANNER_DELAY_MS = 1500;
export const APPROVAL_BADGE_CAP = 9;
export class InstallFailed extends Data.TaggedError('InstallFailed') {}
export interface ChatRows {
export function createRowsSelector(): (state: ChatStoreState) => ChatRows {
export function statusLabel(status: string): string | undefined {
# apps/web/src/components/chatList/ChatListMenu.tsx
export interface ChatListMenuProps {
export function ChatListMenu({
# apps/web/src/components/chatList/ChatListBody.tsx
export interface ChatListBodyProps {
export function ChatListBody({
```

The barrel's exports are identical to the base (`ChatList`, value, same signature). The new files add only names that were module-private on the base (`createRowsSelector`, `statusLabel`, the constants, `InstallFailed`, the two interfaces), so no importer changes.

### Effect ratchet

No `// effect-plain:` marker was needed and none was added. `rowsSelector.ts` imports `effect` as a value (`Data.TaggedError`), so the map classifies it `effect`. `ChatListMenu.tsx` and `ChatListBody.tsx` hold only presentational/React wiring with no hard or weak signals, so they classify `plain`. `ChatList.tsx` still imports `effect` as a value and is `effect`. The gate's `effect` step passed.

### Commands and results

- `pnpm install` — Done, 1172 added, 0 errors (one pre-existing peer-dep warning in `apps/mobile`, `@types/react-dom`).
- `pnpm --filter @zilar/web build` — success, `✓ built in 1.22s` (vite only; types are checked by the gate).
- `pnpm gate` (repo root) — **GATE PASS**:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (2.3s)
PASS  format  (0.7s)
PASS  lint  (1.6s)
PASS  typecheck  (5.3s)
PASS  effect  (1.1s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

- Single test files: none run — this is UI code with no nearby tests, and `grep` shows no test imports `ChatList`. The gate's `tests @zilar/web` step skipped for that reason.
- The first `pnpm gate` run failed only on `format` for the two new `.tsx` files; I fixed it with `pnpm exec prettier --write` on those two files and re-ran the gate (the run above).

### Files changed

- `apps/web/src/components/ChatList.tsx` (modified)
- `apps/web/src/components/chatList/rowsSelector.ts` (new)
- `apps/web/src/components/chatList/ChatListMenu.tsx` (new)
- `apps/web/src/components/chatList/ChatListBody.tsx` (new)
- `work/T-1009-split-web-chat-list.md` (this report)

### Problems / deviations / open questions

- Deviation from the plan range only in naming of exported helpers: `createRowsSelector` and `statusLabel` were module-private and are now exported from `rowsSelector.ts` so the barrel can import them; `ChatList.tsx`'s own export list is unchanged.
- `NavMenuItem` is exactly `{ to, label, badge }`; the menu-close callback reaches it through `MenuCloseContext` rather than a fourth prop, to keep the dedup call sites at three props.
- No open questions. The in-file Dedup is done; the cross-file dedup the plan excludes is untouched.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `ChatList.tsx` (509 lines) is now 187 lines, plus `chatList/{rowsSelector,ChatListMenu,ChatListBody}`. One `NavMenuItem` replaces the copies.
- **The nit:** `NavMenuItem` calls `closeMenu?.()` from a context that defaults to null. It's fine for every current use.
- **The lead checked it in Chrome at `?mock=1`:**
  - the list renders, and ☰ shows Invite a friend, Requests, Chat folders, Blocked people, Explore groups, Profile, Connections, Machines, Approvals (with its badge), My AIs, Notifications, Stickers and Sign out;
  - Machines closes the menu and opens `/settings/machines`.
- **Targets checked in code:** the 11 nav targets are the same as main's `navigate(...)` calls, in the same order.
- **Check:** the gate passed, and so did the web build.
