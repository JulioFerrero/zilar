---
id: T-1865
title: "Phone cleanup after T-1854/T-1858: drop the unused onOpenRequests prop from the people search chain and the now-unreachable request/block actions in use-people-search.ts; the channel screen uses GroupAisList so ais-page.tsx can go"
status: merged
milestone: M5
branch: task/T-1865-phone-search-cleanup
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1865: Phone dead code after the search and People pages

## Spec (written by Claude, do not edit)

### Why
**The follow-ups from two merged reviews:**
- **T-1854** turned the search's person card into a row, so the card's request and block actions and the `onOpenRequests` prop are dead.
- **T-1858** kept `ais-page.tsx` as a 38-line wrapper only because the channel screen imports it.

### Facts (read by the lead on 2026-10-17)
- **`onOpenRequests`:**
  - it is still declared in `apps/mobile/src/components/contacts/people-search-result.tsx:34` but no longer used there;
  - `apps/mobile/src/components/chat/chat-search-results.tsx` declares and passes it on (`:39`, `:58`, `:103`, `:155`, `:164`, `:176`);
  - `apps/mobile/src/app/(tabs)/index.tsx` passes `onOpenRequests={openRequests}` (`:171`, `:194`).
- **`apps/mobile/src/components/contacts/use-people-search.ts`** (200 lines) returns `busy`, `send`, `cancelRequest`, `acceptRequest`, `declineRequest`, `block` and `unblock` (`:31-39`). `PeopleSearchResult` now uses only `view`, `openMessage` and `actionError`.
- **`apps/mobile/src/components/chat/channel-screen.tsx`** imports `AisPage` from `@/components/group-info/ais-page` (`:22`) and renders it (`:189`). `ais-page.tsx` is a 38-line wrapper around `GroupAisList` (`apps/mobile/src/components/group-info/ais-list.tsx`).

### Steps
1. **Remove `onOpenRequests`** from `PeopleSearchResult`, `ChatSearchResults` and `ChatPeopleResults` (both in `chat-search-results.tsx`), and the two props in `(tabs)/index.tsx`. If `openRequests` in `index.tsx` then has no other use, remove it too.
2. **`use-people-search.ts`:** remove the actions and state that nothing reads any more:
   - `send`, `cancelRequest`, `acceptRequest`, `declineRequest`, `block` and `unblock`;
   - `busy`, and its ref, if unused;
   - their helpers.

   Keep `view`, `openMessage` and `actionError`, and keep the lookup unchanged. First grep `apps/mobile/src` for each name, and keep anything still used.
3. **The channel screen:** render `ais-page.tsx`'s content in `channel-screen.tsx`, i.e. its header plus `GroupAisList`, the same way `ais-page.tsx` does today, then delete `ais-page.tsx`. If that would push `channel-screen.tsx` past 400 lines, keep `ais-page.tsx` and say so in the Report.
4. **No tests.** Every file stays at most 400 lines.

### Allowed files
- `apps/mobile/src/components/contacts/people-search-result.tsx`
- `apps/mobile/src/components/chat/chat-search-results.tsx`
- `apps/mobile/src/app/(tabs)/index.tsx`
- `apps/mobile/src/components/contacts/use-people-search.ts`
- `apps/mobile/src/components/chat/channel-screen.tsx`
- `apps/mobile/src/components/group-info/ais-page.tsx`
- `work/T-1865-phone-search-cleanup.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **No behaviour change:**
  - the search still shows the person row and opens the DM or `/u/<handle>`;
  - the channel AIs page still renders.
- **The dead prop and dead actions are gone.**
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Removed the dead `onOpenRequests` prop from `PeopleSearchResult`, `ChatSearchResults` and `ChatPeopleResults`, plus the two passes in `(tabs)/index.tsx`. Its `openRequests` helper in `index.tsx` had no other use, so I removed it too.
- `use-people-search.ts` (now 71 lines): removed `send`, `cancelRequest`, `acceptRequest`, `declineRequest`, `block`, `unblock`, `busy`/`busyRef`, `runAction`, `actOnRequest` and `actionErrorFor`, plus the imports they needed (`Effect`, `ContactsApiError`, `actOnProfileRequestEffect`, `addContactSendFailure`, `performBlockEffect`, `performUnblockEffect`). Kept `view`, `actionError` and `openMessage`; the debounced lookup, the `setApi`/`setText` effects and the Enter-key (`submitRequest`) path are unchanged. The hook ended up with no caller for the returned `lookupNow`, so I dropped it from the return value as well (the controller still owns and runs it internally).
- `channel-screen.tsx` (now 335 lines, under the 400 limit): the `page === 'ais'` branch now renders the old `AisPage` content inline — `SafeAreaView`, back key and "AIs" title, then `ScrollView` + `GroupAisList` — with the needed imports. Deleted `ais-page.tsx`; nothing else referenced it (grep).

### Checks run

`pnpm gate` (from the repo root), after fixing one Prettier warning in `channel-screen.tsx` with `node_modules/.bin/prettier --write` on that file:

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (2.0s)
PASS  format  (1.3s)
PASS  lint  (1.1s)
PASS  typecheck  (4.4s)
PASS  effect  (0.9s)
PASS  tests @zilar/mobile  (2.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

I ran no single test file: no test imports these components or `use-people-search`, and the spec says "No tests".

### Notes for the lead

- `PeopleSearchController.setFound()` in `people-search.ts` is now unused inside the app (only the removed actions called it). `people-search.ts` is not in this task's Allowed files, so I left it alone; it is a candidate for a later cleanup.
- `actionError` can now only be set by `openMessage` ("No chat with them yet…"); the server-error path it used to carry went away with the actions, which is expected.
- Behaviour is unchanged: the found-person row still opens the DM for contacts or pushes `/u/<handle>` for other relations, and the channel AIs page renders the same header + `GroupAisList`.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `ca576e5f3`.
- **I compared the inlined channel AIs page** in `channel-screen.tsx` with the deleted `ais-page.tsx`. The JSX matches line for line: back key, "AIs" title, `GroupAisList` in a `ScrollView`.
- **The rest is dead-code removal.** No emulator run, since nothing visible changed.
- **Follow-up:** `PeopleSearchController.setFound()` in `apps/mobile/src/components/contacts/people-search.ts` has no callers left; drop it in the next task that touches that file.

