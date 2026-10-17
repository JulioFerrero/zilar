---
id: T-1854
title: "Phone search, Julio's '@iryna' screenshot: the exact-handle People result becomes one compact person row (avatar 40, name, @handle, a muted relation hint) like the People list, tapping opens the DM for a contact or /u/<handle>; the Messages section drops the repeated per-chat header and the snippet stops drawing bigger than the sender"
status: merged
milestone: M5
branch: task/T-1854-phone-search-results
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1854: Clean up the phone search results

## Spec (written by Claude, do not edit)

### Why
**Julio (2026-10-17, phone screenshot of a search for `@iryna`):** "looks horrible the card with Iryna, can we make it better?" The screenshot shows three faults:
1. **The People result** is a tall bordered card: a 44 px avatar, name and handle, a big white "Send request" button and a loose "Block" line under it. Everywhere else (the People list section, web's search) a person is one compact row.
2. **The Messages section** repeats the chat: a small header row (20 px avatar + "JULITO") above each group, then every hit again shows the same avatar and "JULITO".
3. **The hit's snippet** ("Hola Iryna") draws bigger than the sender name next to it.

### Facts (read by the lead on 2026-10-17)
- **The exact-handle result:** `apps/mobile/src/components/contacts/people-search-result.tsx` (93 lines) renders `ProfileCard` for `view.status === 'found'` (`:70-90`).
  - It passes `onOpenProfile={() => router.push({ pathname: '/u/[handle]', params: { handle } })}`.
  - `usePeopleSearch` (`apps/mobile/src/components/contacts/use-people-search.ts`) returns `openMessage` (`:180`), which opens the contact's DM, plus `send`, `block`, etc.
  - `view.profile.relation` is one of `'none' | 'contact' | 'request_sent' | 'request_received' | 'blocked' | 'self'`; see the cases in `ProfileCardActionRow`, `apps/mobile/src/components/contacts/profile-card.tsx:145-300`.
- **The compact row to copy:** `PersonRow` in `apps/mobile/src/components/contacts/people-list-section.tsx:61-80`:
  - a `Pressable` with `accessibilityRole="button"` and `accessibilityLabel={`Open ${entry.name}`}`, className `flex-row items-center gap-3 rounded-[12px] px-[10px] py-2 active:bg-surface-raised`;
  - `EntityAvatar` 40;
  - the name in 14 px semibold, the `@handle` in 13 px muted.
- **`/u/[handle]`** (`apps/mobile/src/app/u/[handle].tsx`) is the full profile, with the request, accept and block actions.
- **The Messages section:** `apps/mobile/src/components/chat/message-search-list.tsx` (251 lines).
  - `MessageSearchGroups` draws, per chat group, a header row (`EntityAvatar` size 20 + the title, `:196-209`), then a `MessageSearchHit` per item (`:210-224`).
  - The hit already shows the 36 px avatar and the heading (`:24-58`).
- **The snippet:** `apps/mobile/src/components/chat/search-snippet.tsx`.
  - `SearchHitLine` (`:44-55`) draws the sender at 13 px, then `SearchSnippet`.
  - `SearchSnippet` wraps its parts in nested `Text` from `@/components/ui/text`, whose base classes set their own size, so each nested part ignores the parent's `text-[13px]`.
- **Web is already right:** its hit draws the sender in `text-foreground` and the snippet `text-muted-foreground`, both 13 px (`apps/web/src/components/MessageSearchResult.tsx:97-101`).

### Steps
1. **`people-search-result.tsx`:** replace the `ProfileCard` with one row that looks exactly like `PersonRow`. Move `PersonRow` to a shared `apps/mobile/src/components/contacts/person-row.tsx` and use it in both places. It gets an optional `hint` (12 px, muted, right side, `shrink-0`):
   - `request_sent` → "Requested";
   - `request_received` → "Wants to connect";
   - `blocked` → "Blocked";
   - `self` → "You";
   - otherwise none.

   **A press:**
   - `contact` → `search.openMessage()`;
   - `self` → nothing (disabled);
   - anything else → `/u/[handle]`.

   Keep the existing "Looking up…", missing, rate-limited and error lines.

   **`ProfileCard` is then unused,** so remove it and `ProfileCardActionRow` from `profile-card.tsx`. Keep `shouldResetBlockConfirm`: `apps/mobile/src/components/profile/profile-block.tsx:7` imports it.
2. **`message-search-list.tsx`:** remove the per-group header row (`:196-209`). Keep the "Messages" label and the hits in their current order.
3. **`search-snippet.tsx`:**
   - every nested part in `SearchSnippet` uses `className="text-[13px] text-muted-foreground"` (a mark gets `text-[13px] text-foreground` plus the mark background), so nothing grows;
   - in `SearchHitLine` the sender uses `text-foreground` like web.
4. **No tests** (UI). Every file stays at most 400 lines.

### Allowed files
- `apps/mobile/src/components/contacts/people-search-result.tsx`
- `apps/mobile/src/components/contacts/people-list-section.tsx`
- `apps/mobile/src/components/contacts/person-row.tsx`
- `apps/mobile/src/components/contacts/profile-card.tsx`
- `apps/mobile/src/components/chat/message-search-list.tsx`
- `apps/mobile/src/components/chat/search-snippet.tsx`
- `work/T-1854-phone-search-results.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Searching `@iryna`** shows one compact row (avatar, "iryna", "@iryna") with no button block; tapping opens her profile, where Send request lives.
- **A contact's row** opens the DM.
- **Message hits** have no extra header row, and the snippet is the same 13 px as the sender.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Added `apps/mobile/src/components/contacts/person-row.tsx`: the shared compact person row (40 px avatar, 14 px name, 13 px `@handle`, optional 12 px muted right-side hint). With no `onOpen` it renders the same row as a static `View`, so `self` is not pressable.
- `people-search-result.tsx`: replaced the `ProfileCard` block with one `PersonRow`. The hint maps `request_sent` → "Requested", `request_received` → "Wants to connect", `blocked` → "Blocked", `self` → "You", other relations none. Press: `contact` → `search.openMessage()`, `self` → disabled, anything else → `/u/[handle]`. The "Looking up…", missing, rate-limited and error lines are unchanged.
- `people-list-section.tsx`: deleted its local `PersonRow` and now imports the shared one; behaviour is unchanged.
- `profile-card.tsx`: removed `ProfileCard` and `ProfileCardActionRow` (now unused). Kept `shouldResetBlockConfirm`, which `profile/profile-block.tsx` still imports.
- `message-search-list.tsx`: removed the per-group header row (20 px avatar + title); the "Messages" label and the hit order are unchanged. The hit keeps its own 36 px avatar and heading.
- `search-snippet.tsx`: every nested part now carries `text-[13px] text-muted-foreground` (marks `text-[13px] text-foreground` plus the mark background), so no part grows; the sender in `SearchHitLine` is now `text-foreground` like web.

### Checks run
- `pnpm install --prefer-offline`: Done in 21.8s (only the pre-existing `@types/react-dom` peer warning).
- `pnpm gate`: exit 0, GATE PASS. Summary lines:
  - `gate: 7 changed file(s) against main`
  - `PASS  install (frozen)  (1.7s)`
  - `PASS  format  (1.4s)`
  - `PASS  lint  (0.9s)`
  - `PASS  typecheck  (4.6s)`
  - `PASS  effect  (1.6s)`
  - `PASS  tests @zilar/mobile  (1.8s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`
- No single test file was run: this is UI-only work and the spec says no tests.

### Notes for the lead
- `PeopleSearchResult` still declares the `onOpenRequests` prop because `chat-search-results.tsx` (outside the Allowed files) passes it; the component no longer destructures or uses it. It can be dropped from both places in a follow-up.
- The view's `sent` flag no longer drives any hint: after sending, the row shows no hint until a lookup refreshes the relation. The spec maps hints from `relation` only, so I followed that.
- The row for `contact` calls `search.openMessage()`. If the DM is not in the loaded list, the hook's existing "No chat with them yet. Pull to refresh the chats list." sentence is now rendered as a small danger line under the row, so the failure is still visible after the card's error slot went away.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `4109737ae`.
- **The emulator check:** `pnpm phone:smoke` passed on the mock build.
  - **Searching `@theo`** shows one compact row (the orb, "Theo", "@theo", and "Wants to connect" on the right) instead of the tall card with a big button and a loose Block.
  - **Searching "staging"** shows two message hits ("Dev team › Checkout button hidden on Saf…", "Dev team › General") with no extra header row, and the snippet is the same size as the sender, with the match highlighted.
- **Follow-ups (cleanup):**
  - the unused `onOpenRequests` prop on `PeopleSearchResult` and its callers;
  - the now-unreachable request and block actions in `use-people-search.ts`.
