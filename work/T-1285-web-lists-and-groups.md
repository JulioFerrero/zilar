---
id: T-1285
title: "Web: contact requests show as a row at the top of the chat list (WUX-19); New group gets member search and allows zero members (WUX-20); message search results highlight the selected row (WUX-23); Esc in a wide layout closes the open chat (WUX-33)"
status: merged
milestone: M5
branch: task/T-1285-web-lists-and-groups
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1285: Requests row, New group search, search selection, Esc (web)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/web-ux-audit.md`:
- **WUX-19** (P2, `:47`): incoming contact requests are only a badge inside the hamburger menu (`apps/web/src/components/chatList/ChatListMenu.tsx`), polled, and easy to miss.
- **WUX-20** (P3, `:51`): `apps/web/src/components/NewGroupDialog.tsx` has no member search and demands at least one member.
- **WUX-23** (P3, `:65`): message search rows always pass `selected={false}` (`apps/web/src/components/MessageSearchResults.tsx`), and Enter opens only the top hit.
- **WUX-33** (P3, `:105`): Esc in a wide layout with a chat open does nothing (`apps/web/src/routes/ChatShell.tsx`).

**First recheck each finding on main.** For any already fixed, say so with `file:line` and skip it.

### What to build
1. **WUX-19:** when there are pending incoming requests, show a row at the top of the chat list ("Contact requests" with the count) that opens the existing requests page (cite it). Use the existing polled count.
2. **WUX-20:**
   - a search box filtering the contact list in the member step;
   - "Create" works with zero members. Check that the server accepts an empty member list: cite the route. If it doesn't, keep the minimum and say so.
3. **WUX-23:** ↑ and ↓ move a highlighted row in the message search results, Enter opens the highlighted hit, and the highlighted row passes `selected`.
4. **WUX-33:** in the wide layout, Esc with a chat open (and no dialog, menu or search open) closes the chat back to the empty state.
5. **No tests** (UI). Keep every file at most 400 lines.

### Read first
`AGENTS.md`, `docs/audit/web-ux-audit.md` (`:47-53`, `:65`, `:105`), and the files above.

### Allowed files
`apps/web/src/components/chatList/*.tsx`, `apps/web/src/components/NewGroupDialog.tsx`, `apps/web/src/components/NewGroupMembers.tsx`, `apps/web/src/components/MessageSearchResults.tsx`, `apps/web/src/components/MessageSearchResult.tsx`, `apps/web/src/routes/ChatShell.tsx`, `apps/web/src/lib/*.ts`, `work/T-1285-web-lists-and-groups.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the web mock:** the requests row shows (if the mock seeds a request); New group filters contacts; the search rows highlight with the arrows; Esc closes the chat.

---

## Report (written by the worker when done)

### Recheck on main (all four still present, none already fixed)

- **WUX-19** — still only a badge in the hamburger menu (`apps/web/src/components/chatList/ChatListMenu.tsx:101-114`); `ChatListBody.tsx` had no requests row.
- **WUX-20** — `NewGroupDialog.tsx`'s member step had no search box and the Next button was `disabled={selected.length === 0}`.
- **WUX-23** — `MessageSearchResults.tsx` rendered every hit with `selected={false}`; no arrow navigation; Enter opened `items[0]` only.
- **WUX-33** — `ChatShell.tsx` closed the chat on Escape only when `!isWide`.

### What I did

1. **WUX-19** — New `apps/web/src/components/chatList/ContactRequestsRow.tsx`: uses the existing polled `useContactRequestCount` hook; when the count is > 0 it renders a "Contact requests" row with the count (capped at `9+`) at the top of `ChatListBody`, linking to `/settings/requests` (route `apps/web/src/routes/AppRoutes.tsx:205`, page `apps/web/src/routes/RequestsPage.tsx`).
2. **WUX-20** — New `apps/web/src/components/NewGroupMembers.tsx` holds the contact list plus a `SearchField` filtering by name or handle; `NewGroupDialog` now renders it and the Next button is enabled with zero members. **The server accepts an empty member list**: `CreateGroupPayload.memberIds` is optional (`packages/api-contract/src/groups.ts:42`; `MemberIds` only has an upper bound, `:35-37`), the route forwards `request.payload.memberIds ?? []` (`apps/server/src/groups/api.ts:150`), and existing tests create with `memberIds: []` (`apps/server/src/groups/visibility.test.ts:167,177`).
3. **WUX-23** — `MessageSearchResults` now renders a keyed `MessageHitList` with a highlighted index: Up/Down (from the search box or the list) move the highlight, Enter opens the highlighted hit, and the highlighted row passes `selected` to `MessageSearchResult` (existing `bg-surface-raised` + `aria-current` styling). The list is keyed by query + scope so a new search starts at the first hit.
4. **WUX-33** — `ChatShell`'s Escape handler now also closes the chat on wide layouts. It skips while a search is open (`search` text or a scoped `searchChat`), so the first Escape clears the search and the next closes the chat; dialogs/menus already swallow their own Escape before window listeners (`ui/use-modal.ts:65`, `ui/menu.tsx:76`, `StickerPanel.tsx:191`). Narrow-layout behaviour is unchanged.

### Files changed (all inside Allowed files)

- `apps/web/src/components/chatList/ContactRequestsRow.tsx` (new)
- `apps/web/src/components/chatList/ChatListBody.tsx`
- `apps/web/src/components/NewGroupMembers.tsx` (new)
- `apps/web/src/components/NewGroupDialog.tsx`
- `apps/web/src/components/MessageSearchResults.tsx`
- `apps/web/src/routes/ChatShell.tsx`
- `work/T-1285-web-lists-and-groups.md`

All files stay under 400 lines (largest: `NewGroupDialog.tsx` 330).

### Commands

- `pnpm install` — Done.
- `pnpm gate` (root) — final run:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.8s)
  PASS  lint  (0.8s)
  PASS  typecheck  (5.6s)
  PASS  effect  (1.1s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- Tests: none (UI-only change; the gate reports no nearby test files). I did not run any other suites.
- An earlier gate run failed `format` on `MessageSearchResults.tsx` and `NewGroupMembers.tsx`; I fixed it with `pnpm exec prettier --write` on those two files, then the next gate run failed `lint` (two `react` rules), which I fixed in code (highlight state moved into a keyed child instead of `setState` in an effect; index map instead of a reassigned counter), then re-ran the gate to the pass above.

### Deviations and notes

- **WUX-19 duplicate poll:** `ChatList.tsx` (the component that already calls `useContactRequestCount` for the menu badge) is *not* in the Allowed files, so `ContactRequestsRow` calls the same existing hook itself. This polls `GET /api/contacts/requests` once more per 60 s / window focus alongside the menu badge. Same existing hook, no new dependency; folding it into one shared read would need a small change in the store or `ChatList.tsx`.
- **WUX-33 scope:** the "no dialog/menu/search open" rule is enforced by the store search check plus the existing `stopPropagation` in the modal/menu/sticker components; select-mode (`SelectionBar`) never stopped propagation on narrow either, so its Escape still closes the chat on both layouts (pre-existing behaviour, unchanged).
- No architecture, security or dependency decisions were needed.

### Disagreements

- **Finding 1 (should-fix) — I believe this finding is wrong, so I left the code as it is.**
  The finding says Enter on a keyboard-focused hit row fires twice: the list `div`'s `onKeyDown` opens the highlighted hit, then the focused row button's native activation runs `onClick` → `onOpen` for the focused hit.
  The `div`'s Enter branch calls `event.preventDefault()` **before** `openAt(highlighted)` (`apps/web/src/components/MessageSearchResults.tsx:165-168`). Cancelling the keydown's default action suppresses the button's Enter activation, so its `onClick` never runs.
  I reproduced the exact structure in Chrome (the browser the web mock is checked in): a `<button>` inside a `<div>` whose React `onKeyDown` calls `preventDefault()` on Enter. Pressing Enter on the focused button gave `{ clicks: 0, keys: 1, opened: "highlighted" }` — one handler run, no button click. A plain (non-React) DOM version of the same test gave the same result. The current code therefore already opens the highlighted hit exactly once, matching spec item 3.

### Round (fix round)

- Findings: 1 should-fix, 0 must-fix. **Fixed: none** — finding 1 is, I believe, incorrect (see Disagreements above), and the round rules say to leave wrong-finding code untouched.
- Nits 2 and 3: not touched (nit fixes are only in scope inside a line this round actually changes; no lines changed).
- Follow-up F1: not addressed (needs `ChatList.tsx`, outside the Allowed files; follow-up only).
- Tests added/adjusted: none (no behaviour change).
- `pnpm gate` (root), final run — ends with `GATE PASS`:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (2.3s)
  PASS  format  (1.4s)
  PASS  lint  (0.9s)
  PASS  typecheck  (1.0s)
  PASS  effect  (0.6s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  No single tests were run (no code changed this round).

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean after 1 auto round (2 nits, 1 follow-up).**
- **Lead's check on the web mock:**
  - Esc on an open chat returns to `/`;
  - in New group, "Search contacts" with "ma" filters to Marta, Marco and Marketing AI, and Next is enabled with zero members;
  - the mock seeds no contact requests, so I checked the requests row (`chatList/ContactRequestsRow.tsx`) in the code.
- **Lead's checks after the rebase:** web tsc: 0 errors. `MessageSearchResults.tsx` is 306 lines.
- **Follow-up:** the requests row repeats `ChatList`'s 60 s requests poll; share the count later.
