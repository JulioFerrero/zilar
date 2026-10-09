---
id: T-0841
title: "Mobile fix: after Accept, Decline or Cancel on the @handle people-search card, the card shows the refreshed profile, not the pre-action one"
status: merged
milestone: M5
branch: task/T-0841-people-search-stale-card
model: auto
effort: default
depends_on: [T-0833]
estimate: 0.1 day
---

# T-0841: people-search card stays stale after a request action

## Spec (written by Claude, do not edit)

### Why
The T-0833 worker found an older bug, present before the Effect conversion. In the chat-list `@handle` search, after Accept, Decline or Cancel on the card, the refreshed profile is overwritten by the profile from before the action. So the card keeps showing the old relation (for example "Accept" after accepting) until the next lookup. The comment at `apps/mobile/src/components/contacts/add-contact.ts:74-79` says the refresh exists to show the new relation.

### Verified facts (on main after T-0833 merged; re-read before editing)
- **The shared action:** `actOnProfileRequestEffect` in `apps/mobile/src/components/contacts/add-contact.ts` (about lines 80-104) runs the request action, looks the handle up again, then calls `onProfile(found)` and **after it** `onSentNone()` (about lines 102-103).
- **The bug:** in `apps/mobile/src/components/contacts/use-people-search.ts`, `actOnRequest` (about line 96) passes `onProfile = (found) => controller.setFound(found, false)` and `onSentNone = () => controller.setFound(active, false)`, where `active` is the profile from **before** the action. The second call writes the old profile back over the new one.
- **The controller:** `PeopleSearchController.setFound(profile, sent)` in `apps/mobile/src/components/contacts/people-search.ts:135` sets `{ status: 'found', profile, sent }`, so the first call already clears `sent`.
- **The other caller is correct:** `apps/mobile/src/app/u/[handle].tsx:141` passes `setProfile` and `() => setSent(false)`, which touch separate state.

### What to build
1. In `use-people-search.ts`, the `onSentNone` callback must not replace the profile. Make it a no-op (`() => undefined`), because `setFound(found, false)` already sets `sent: false`. Add a one-line comment saying why.
2. **Test first.** In the existing `apps/mobile/src/components/contacts/use-people-search.test.tsx` (added by T-0833; use the real file name), add a test: a card in the incoming-request state, Accept, the API's second lookup returning the profile as a contact. The view must then show the refreshed profile. The test fails on the old code and passes after the fix.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the three files above and the existing `use-people-search` test.

### Allowed files
`apps/mobile/src/components/contacts/use-people-search.ts`, `apps/mobile/src/components/contacts/use-people-search.test.tsx` (or the existing test file's real name), `work/T-0841-people-search-stale-card.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/contacts
pnpm --filter @zilar/mobile typecheck
pnpm exec oxlint apps/mobile/src/components/contacts/use-people-search.ts
```

### Acceptance
- The new test fails before the fix and passes after; the contacts tests pass 3 of 3.
- Typecheck and oxlint are clean, and only Allowed files change.

---

## Report (written by the worker when done)

- Files changed: `apps/mobile/src/components/contacts/use-people-search.ts`, `apps/mobile/src/components/contacts/use-people-search.test.ts` (the real name is `.ts`, not `.tsx`), this task file.
- Fix: the `onSentNone` callback passed from `actOnRequest` is now `() => undefined` with a comment. `setFound(found, false)` already clears `sent`, so the old `setFound(active, false)` no longer overwrites the refreshed profile.
- New test: `accept shows the refreshed relation, not the one from before the action` (request_received card, Accept, second lookup returns `contact`; expects the view to equal the refreshed profile with `sent: false`).
- Test counts (`pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/contacts`):
  - before the fix: 1 failed, 123 passed (124 total, 9 files). The new test failed with `relation: "request_received"` where `"contact"` was expected.
  - after the fix: 124 passed (124 total, 9 files). Run 3 times in total, all green.
- `pnpm --filter @zilar/mobile typecheck`: exit 0.
- `pnpm exec oxlint` on `use-people-search.ts`: exit 0. The test file was also linted and formatted with prettier.
- Behaviour differences: none other than the fix. Decline and Cancel go through the same `actOnRequest` path, so they get the same fix; I tested Accept only, as the spec asked.
- Unsure: the Decline and Cancel paths are covered by code reading, not by a test. The `onSentNone` parameter stays in `actOnProfileRequestEffect`, since `add-contact.ts` and its other caller still pass it.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the Report and the diff.
- **The fix:** `onSentNone` in `use-people-search.ts` is a no-op, because `setFound(found, false)` already clears `sent`, so the refreshed profile stays on the card.
- **The test:** the new test failed on the old code (`request_received` instead of `contact`) and passes now. The contacts tests give 124 passed, 3 of 3 runs; typecheck and oxlint are clean.
- **Coverage:** Decline and Cancel take the same path.
