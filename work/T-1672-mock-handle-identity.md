---
id: T-1672
title: "Mock backend: a seed person's @handle resolves to their seed id (u-marta, not u-handle-marta) with relation 'contact', so mock profiles show Message/Mute and the phone resolves the right DM chat (fixes the lead's T-1664 QA and T-1668's follow-up)"
status: merged
milestone: M5
branch: task/T-1672-mock-handle-identity
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1672: Mock handles resolve to seed people

## Spec (written by Claude, do not edit)

### Why
In mock mode (web and phone), `/u/marta` shows "Send request" for Marta even though she's a contact with a DM. The profile's DM actions also resolve the wrong chat: the lead's emulator QA of T-1664 got "Could not load media", while the same sheet from the chat header works.

The cause: the by-handle lookup (and T-1668's `/users/search`) return the synthetic id `u-handle-marta` instead of the seed id `u-marta`. The relation also never says `contact`.

### Facts (the lead read them on 2026-10-16)
- **`packages/mock-backend/src/domains/handles/check.ts`** (112 lines):
  - `handleUserId(data, raw)` (`:33-46`) returns `anaId(data)` for the taken handle, else `` `u-handle-${normalized}` ``;
  - `handleProfile(data, raw)` (`:49-83`) gives the relation `self`, `blocked`, `request_sent`, `request_received` or `none`;
  - `handleProfileForId` (`:97-…`) names the synthetic `u-handle-*` strangers.
- **Seed people** (`packages/mock-backend/src/data/people.ts:22-31`): `{ id: 'u-marta', name: 'Marta', jid: 'marta@zilar.test', kind: 'human', handle: 'marta' }` and the same for ana, luis, marco and sofia. The AIs have no handle.
- **Contacts:** `GET /contacts` lists `data.people.filter((person) => data.isContact(person.id))` (`packages/mock-backend/src/domains/contacts/routes.ts:37-46`), so every seed person counts as a contact until removed.
- **The contract's relations** include `'contact'` (`packages/api-contract/src/contact-requests.ts:84`).
- **The synthetic strangers stay as they are.** The contact-request seed relies on them (`packages/mock-backend/src/domains/contact-requests/seed.ts:1-8`).
- **The phone profile** resolves its DM through `resolveDmChatId(userId, contacts, domain)`, which returns `contact.jid` when the contact list has that `userId` (`apps/mobile/src/components/chat/dm-chat-id.ts:18-28`).

### Steps
1. **In `handleUserId`:** after the reserved and pattern checks, if a seed person has `handle === normalized`, return that person's `id`. Keep the taken-handle branch and the synthetic fallback for unknown handles.
2. **In `handleProfile`:** for a seed person who `data.isContact(userId)`, and isn't blocked and has no pending request, return `relation: 'contact'`. Keep the person's real `handle`.
3. **Run the mock-backend tests and fix any that pinned the old ids,** if any (the lead found none by grep).

### Allowed files
- `packages/mock-backend/src/domains/handles/check.ts`
- `work/T-1672-mock-handle-identity.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **In mock mode, `GET /users/by-handle/marta`** answers `{ userId: 'u-marta', relation: 'contact', … }`.
- **An unknown handle** still answers a synthetic `u-handle-*` stranger.
- **The contact-request seed works as before.**

---

## Report (written by the worker when done)

### What I did
- **`packages/mock-backend/src/domains/handles/check.ts`**:
  - `handleUserId`: after the reserved and pattern checks, it now looks up a seed person whose `handle === normalized` and returns that person's seed `id` (`marta` → `u-marta`). The taken-handle alias (`taken_user` → Ana) and the synthetic `u-handle-*` fallback for unknown handles are unchanged.
  - `handleProfile`: the returned `handle` is now the seed person's real handle (`person.handle`) when the id is a seed person, otherwise the input as before. The final `relation` now returns `'contact'` when the resolved id is a seed person, is a contact (`data.isContact`), is not blocked and has no pending request; `blocked`, `request_sent`, `request_received`, `self` and `none` keep their existing order and meaning.
  - Updated the file header comment to describe the seed-handle resolution.
- No other file changed. `T-1668`'s `GET /users/search` (`searchPeople`) builds each entry through `handleProfile`, so it inherits both fixes without its own edit.

### Checks run
- `pnpm install` — done, clean.
- Grep for the old synthetic ids (`u-handle-marta`, `by-handle/marta`, `u-handle-`): no test pinned the old ids; the only remaining `u-handle-*` uses are the synthetic strangers (contact-request seed `cr-seed-1/2`, `handleProfileForId`, blocks' `isKnownUser`), which the spec says to keep.
- `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot` → `Test Files 2 passed (2)`, `Tests 7 passed (7)`.
- `pnpm gate` (repo root), real summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (0.7s)
  PASS  lint  (1.2s)
  PASS  typecheck  (3.0s)
  PASS  effect  (1.8s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The two changed files are `packages/mock-backend/src/domains/handles/check.ts` and this task file, both Allowed. The gate skipped the mock-backend tests because `check.ts` has no nearby test file; I ran the package's tests directly (above).

### Acceptance (traced through the code, not a live HTTP call)
- `GET /users/by-handle/marta` → `handleUserId` finds the seed person with handle `marta` and returns `u-marta`; `handleProfile` finds `u-marta`, not blocked, no pending request, `isContact('u-marta')` is true (nothing removed) → `{ userId: 'u-marta', name: 'Marta', handle: 'marta', relation: 'contact', … }`.
- An unknown handle (`some_guy`) still has no seed person, so `handleUserId` returns `u-handle-some_guy` and the profile's `relation` stays `none`.
- The contact-request seed is untouched: it uses the synthetic `u-handle-nora` / `u-handle-theo`, `handleProfileForId` is unchanged, and the seed still resolves as before.

### Notes for the lead
- Side effect worth knowing: the `taken_user` alias resolves to Ana (`u-ana`), a seed person, so `GET /users/by-handle/taken_user` now returns her real handle `ana` and `relation: 'contact'` instead of the previous `handle: 'taken_user'` / `relation: 'none'`. No test pins the old value, and it matches "keep the person's real handle", but flag it if the alias is meant to stay opaque.
- I did not add a test: the change is mock-backend identity plumbing, and the repo has no test next to `check.ts`; the task's step 3 only asked to fix tests that pinned the old ids (none did).

### Round (fix round 1)

- **Fixed finding 1 (should-fix):** in `handleProfile` (`check.ts:59-62`), when the queried input normalizes to the always-taken alias, the profile now echoes that alias as `handle` instead of the seed person's `ana`. `GET /users/by-handle/taken_user` answers `{ userId: 'u-ana', name: 'Ana', handle: 'taken_user', … }` again, matching T-1067's pinned proof (`handle:"taken_user"`); `personHandle(u-ana)` still reports `taken_user`, so the alias stays one name. Only `check.ts` changed.
- **Tests added: none.** Finding 1 names no test. The test request is finding 2, a follow-up whose own text says a handles-domain test file is outside this task's Allowed files; the gate scope check accepts only the two Allowed paths, so I did not create a file outside scope. I ran the package suite instead: `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot` → 2 files passed, 7 tests passed.
- **Not done (out-of-scope follow-ups):** finding 3 (`checkHandle` still reports seed handles like `marta` as available) needs `data.people` threaded into `checkHandle` and touches `me/routes.ts` and `handles/routes.ts`, outside Allowed files.
- **Gate (from the repo root), real summary lines:**
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (1.3s)
  PASS  lint  (0.8s)
  PASS  typecheck  (2.4s)
  PASS  effect  (0.5s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The two changed files are `packages/mock-backend/src/domains/handles/check.ts` and this task file, both Allowed.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean after one automatic round; 1 nit, 2 follow-ups.
- **The change:** in mock `handleUserId`, a handle that names a seed person returns that person's seed id, so `by-handle/marta` → `u-marta` with relation `contact`. `taken_user` still maps to Ana, and an unknown handle still gives `u-handle-*` and `none`. Blocked and pending requests still win over `contact`.
- **Follow-ups, recorded (mock only, low value):**
  - `checkHandle` still calls a seed handle such as `marta` "available";
  - a contact request to an existing contact isn't refused.
- **Still to check:** the emulator check (Marta's profile shows Shared media) is in the next phone QA pass.
- **Lead slip:** this Review missed T-1672's own review commit (the Edit matched twice and failed), so it was added in T-1682's review commit.
