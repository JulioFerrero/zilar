---
id: T-2052
title: "Share W3-d: one person-link resolver in chat-core (Julio's 'best of both': user ids match case-insensitively, a full occupant JID is dropped but userId/handle still count, the group-member handle is the last fallback, yourself opens nothing) — web usePersonHref and phone personTarget become thin route adapters — with tests"
status: merged
milestone: M5
branch: task/T-2052-shared-person-link
model: deepseek/deepseek-flash
effort: default
estimate: 35 min
---

# T-2052: Shared person-link resolver (share plan W3-d)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18, on share-plan question 3: person links take the **best of both**. Today the web and phone rules drift:
- **User ids:** web compares them case-sensitively; the phone lowercases them.
- **Full occupant JID:** web returns nothing at all; the phone drops only the JID and still tries the user id and handle.
- **Fallback:** only web falls back to a group member's handle.

This task makes one tested rule in chat-core.

### Facts (read by the lead on 2026-10-18 at `13819b0fd`)
- **Phone.** `apps/mobile/src/lib/person-link.ts` (68 lines): `personTarget(target, { contacts, chats, currentUserId })` returns a `PersonLinkRoute` (`/chat/[id]` or `/u/[handle]`) or undefined.
  - Rules (`:40-66`): drop a JID containing `/`; self by lowercased `userId` or JID localpart; contact by `normalizeJid` or lowercased `userId`; a non-group chat by `normalizeJid(id)`; else the trimmed `handle`.
  - Used by `apps/mobile/src/components/chat/person-pressable.tsx:7,15`.
- **Web.** `apps/web/src/components/personLink.tsx` (142 lines): `usePersonHref(target)` (`:26-84`).
  - Rules: a JID with `/` returns undefined at once (`:38-40`); the self checks; contact by bare JID or **exact** `userId` (`:50-54`); a non-group chat (`:71`); then `handle ?? memberHandle(groupInfos, bare)` (`:77`).
  - `memberHandle` (`:91-100`) scans the loaded `GroupDetail` members by lowercased `userId` against the localpart.
  - A contact's `onOpen` refreshes chats when the DM row isn't loaded (`:60-64`).
- **Shared homes.** `@zilar/protocol` exports `normalizeJid` (bare and lowercase) and `jidLocal`, and `packages/chat-core` already depends on it. The chat-core barrel `packages/chat-core/src/index.ts` (59 lines) ends with `export * from './sticker-recents';`.

### Steps
1. **The shared resolver.** Create `packages/chat-core/src/person-link.ts`. Its signature:

   ```ts
   resolvePerson(target, ctx): PersonDestination | undefined
   ```

   - `target`: `{ jid?: string; userId?: string; handle?: string | null }`.
   - `ctx`: `{ contacts: readonly { jid: string; userId: string }[]; chats: readonly { id: string; kind: string }[]; currentUserId: string; memberHandle?: (localpart: string) => string | undefined }`.
   - `PersonDestination`: `{ kind: 'contact'; chatId } | { kind: 'chat'; chatId } | { kind: 'profile'; handle }`.

   The rules, in this order:
   - (a) A `jid` containing `/` is dropped; `userId` and `handle` still count.
   - (b) Self opens nothing: a lowercased `userId`, or a JID localpart, equal to the lowercased `currentUserId`.
   - (c) A contact matches by `normalizeJid` or by **lowercased** `userId`.
   - (d) A non-group chat matches by `normalizeJid(chat.id)`.
   - (e) Otherwise the trimmed `handle` opens the profile; when there's none, `memberHandle(jidLocal(jid))` is tried, only when a usable `jid` exists.
   - (f) Otherwise undefined.

   Append ONE line `export * from './person-link';` at the **end** of the chat-core barrel.
2. **Tests.** Add `packages/chat-core/src/person-link.test.ts`, one case per rule:
   - self by mixed-case `userId`, and self by JID;
   - a contact by mixed-case `userId`;
   - a DM chat by JID; a group chat never matches;
   - a full occupant JID with a handle gives the profile;
   - the member-handle fallback;
   - an unknown person gives undefined.
3. **Web.** In `personLink.tsx`, `usePersonHref` calls `resolvePerson`, passing `memberHandle` built from `groupInfos` (keep the helper, now taking a localpart). It maps:
   - `contact` → `/c/<id>`, with the existing refresh `onOpen`;
   - `chat` → `/c/<id>`;
   - `profile` → `/u/<handle>`.

   `PersonLink` is unchanged.
4. **Phone.** In `apps/mobile/src/lib/person-link.ts`, `personTarget` calls `resolvePerson` (no `memberHandle` yet) and maps to its two routes. Keep the `PersonTarget`, `PersonLinkContext` and `PersonLinkRoute` exports.
5. **Size.** Report the line counts. Each file stays at or under 400 lines.

### Allowed files
- `packages/chat-core/src/person-link.ts`
- `packages/chat-core/src/person-link.test.ts`
- `packages/chat-core/src/index.ts`
- `apps/web/src/components/personLink.tsx`
- `apps/mobile/src/lib/person-link.ts`
- `work/T-2052-shared-person-link.md`

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run src/person-link.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- **Lead check, web mock:**
  - tapping a group sender's name opens their DM or profile;
  - your own name opens nothing.

---

## Report (written by the worker when done)

### What I did

- Added `packages/chat-core/src/person-link.ts`: `resolvePerson(target, ctx)` implements the shared rule in the spec's order — drop a JID containing `/` (userId/handle still count), self opens nothing by lowercased userId or JID localpart, contact by `normalizeJid` or lowercased userId, non-group chat by `normalizeJid(chat.id)`, trimmed handle, then `memberHandle(jidLocal(jid))` only when a usable JID exists, else `undefined`. Returns `contact`/`chat`/`profile` destinations.
- Appended `export * from './person-link';` as the last line of `packages/chat-core/src/index.ts`; no other barrel line touched.
- `apps/web/src/components/personLink.tsx`: `usePersonHref` now calls `resolvePerson` and maps `profile` → `/u/<handle>`, `chat`/`contact` → `/c/<chatId>`, keeping the existing chat refresh `onOpen` for contacts. `memberHandle` helper kept but now takes a localpart. `PersonLink` unchanged.
- `apps/mobile/src/lib/person-link.ts`: `personTarget` calls `resolvePerson` (no `memberHandle`) and maps to `/chat/[id]` or `/u/[handle]`; `PersonTarget`, `PersonLinkContext`, `PersonLinkRoute` exports kept.
- Added `packages/chat-core/src/person-link.test.ts` with 8 cases: self by mixed-case userId, self by JID, contact by mixed-case userId, DM by JID, group never matches, full occupant JID with handle → profile, member-handle fallback, unknown → undefined.

Files changed: `packages/chat-core/src/person-link.ts` (new, 89 lines), `packages/chat-core/src/person-link.test.ts` (new, now 74 lines after the fix round), `packages/chat-core/src/index.ts`, `apps/web/src/components/personLink.tsx` (126 lines), `apps/mobile/src/lib/person-link.ts` (44 lines), this task file.

### Checks run

- `pnpm install` — done, no errors.
- `pnpm --filter @zilar/chat-core exec vitest run src/person-link.test.ts --reporter=dot` — 1 file passed, 8 tests passed.
- `pnpm gate` (from repo root):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (2.5s)
  PASS  format  (1.4s)
  PASS  lint  (2.8s)
  PASS  typecheck  (10.3s)
  PASS  effect  (3.5s)
  PASS  build @zilar/server  (1.6s)
  PASS  tests @zilar/chat-core  (2.3s)
  PASS  tests @zilar/mobile  (4.2s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- Deviation: `PersonLinkTarget`'s optional props are declared `string | undefined` (and `handle` `string | null | undefined`). With `exactOptionalPropertyTypes`, the web adapter passes a destructured `{ jid, userId, handle }`, which does not assign to bare `jid?: string`. Types and behaviour are otherwise as specified.
- Web behaviour is unchanged except that user ids now match case-insensitively (the intended "best of both"), and an empty/whitespace handle no longer blocks the member-handle fallback.
- The phone still passes no `memberHandle`, as the spec says; its routes and exports are unchanged.
- The lead check (web mock: group sender opens DM/profile, own name opens nothing) is not something I ran — no browser/device work in this task; the gate covered types and package tests.
- Security checklist: no secrets, logging, routes, deletes, caps or audit entries are touched; this is link resolution only.

### Round (fix round 1)

- Findings fixed: 1 should-fix (PREREVIEW finding 1, vacuous self tests). No must-fix.
- `packages/chat-core/src/person-link.test.ts`: `CURRENT_USER` is now the user-id-style `'user-me'`, so the self tests reach the self branch; they use `'User-Me'` and `'USER-ME@zilar.test'`. Each self test also gives the current user a matching contact / DM chat, so deleting the self early-return fails both tests. Verified by temporarily disabling the branch (`if (false && …)`): 2 tests failed; with the branch restored, 8/8 pass. No production code changed in this round.
- Test run: `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/person-link.test.ts` — 1 file passed, 8 tests passed (8/8).
- `pnpm gate` (from repo root):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.2s)
  PASS  lint  (0.9s)
  PASS  typecheck  (1.9s)
  PASS  effect  (0.4s)
  PASS  build @zilar/server  (0.5s)
  PASS  tests @zilar/chat-core  (1.8s)
  PASS  tests @zilar/mobile  (1.6s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

No disagreements.

## Review (written by Claude)

Approved after 1 auto round; the pre-review was clean, with 1 nit about a test gap for occupant JID plus userId.
- **What changed.** `resolvePerson` in chat-core applies Julio's "best of both" rules (a)–(f), with tests. Web `usePersonHref` and phone `personTarget` are route adapters.
- **Size.** +50 product lines, expected: the value is one tested rule.
- **Lead Playwright check** (web mock, :5196):
  - General links Dev-1, Ana, Luis and Marco to their DMs;
  - "Checkout button hidden" links Dev-1 and QA-1;
  - no self links;
  - no console errors.
- **Follow-up:** the phone's member-handle fallback is not wired yet.
