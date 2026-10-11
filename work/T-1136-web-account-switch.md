---
id: T-1136
title: "Web: signing in as another account while one is still signed in kept the old account's chat session until reload — /login redirects when signed in, and the chat store fully resets and restarts when the signed-in user id changes"
status: todo
milestone: M5
branch: task/T-1136-web-account-switch
model: auto
effort: default
depends_on: [T-1134]
estimate: 0.2 day
---

# T-1136: Account switch keeps the old chat session

## Spec (written by Claude, do not edit)

### Why
Found by the lead on 2026-10-11 during the T-1134 local-stack check, and **reproduced on main**.

**Steps:**
1. In a browser, account B is signed in.
2. Open `/login`. The form shows even though B is signed in.
3. Sign in as account A with the email code.

**What happens:** the server session is now A (the handle page offers A's username), but the chat list is still B's. Messages sent go out under **B's** name, and B's messages show as "own", until the page is reloaded. This is an auth bug: one account acts as another.

**The cause the lead read:**
- **`apps/web/src/store/ChatStoreProvider.tsx:46-52`** starts and stops the store only on `auth.status`. Going from B to A keeps `'authenticated'`, so the effect never re-runs.
- **`stopStore` keeps the message ledger on purpose** (`apps/web/src/store/effects/lifecycle.ts:38-39`). Only `signOutStore` (`:41-93`) clears user state: the ledger caches, the chat-list cache, the handle-gate dismissal, `cachedUserId`, lastRead, and the big `ctx.set` reset. It then calls `authClient.signOut()` and `goToLogin()` (`:90-92`).
- **The user id is available:** `apps/web/src/auth/AuthProvider.tsx` exposes `auth.user.id` (`:58-64`).
- **`/login` has no signed-in guard:** `apps/web/src/routes/AppRoutes.tsx:112` routes it straight to `apps/web/src/routes/LoginPage.tsx`. After a sign-in, `apps/web/src/components/auth/AuthFlow.tsx:165-170` navigates to `location.state.from`.

### What to build
1. **`lifecycle.ts`:** split `signOutStore` into two parts.
   - `resetUserState(ctx)` holds everything from `ctx.get().stop()` through `ctx.messageBaseTexts.clear()`, unchanged and in the same order.
   - `signOutStore` calls `resetUserState`, then `authClient.signOut()` and `goToLogin()` as today.
   - Behaviour of sign-out stays identical.
2. **A store action `switchUser()`** (in `apps/web/src/store/effects/chatActions.ts`, beside `signOut`, and typed in `apps/web/src/store/store.ts`) runs `resetUserState`.
3. **`ChatStoreProvider.tsx`:** add `auth.user?.id` to the start effect.
   - Remember the user id the store was started for, in a `useRef`.
   - When the effect runs with a **different defined id than the one remembered**, call `switchUser()` before `start()`.
   - The same user re-running the effect (for example a status flicker) must **not** reset; that keeps R10.
   - Cleanup still calls `stop()`.
4. **`LoginPage.tsx`:** when `auth.status === 'authenticated'`, render `<Navigate to="/" replace />`, so a signed-in person never sees the form. Signing in as someone else needs a sign-out first, as in Telegram. **Exception:** keep the form when the auth status is `'loading'`.
5. **Tests** (auth), with at most 2:
   - `resetUserState` clears `chats`, `me` and `currentUserId`, and the message author, origin-id and base-text caches. Put it in a new `apps/web/src/store/effects/switchUser.test.ts` and reuse the setup style of `apps/web/src/store/effects/sendFailure.test.ts`.
   - Optionally, the provider calls `switchUser` when the id changes from B to A, and not for the same id twice.
6. **No other behaviour change.**

### Read first
`AGENTS.md`, `apps/web/src/store/ChatStoreProvider.tsx`, `apps/web/src/store/effects/lifecycle.ts`, `apps/web/src/store/effects/chatActions.ts`, `apps/web/src/store/store.ts`, `apps/web/src/routes/LoginPage.tsx`, `apps/web/src/auth/AuthProvider.tsx` and `apps/web/src/store/effects/sendFailure.test.ts`.

### Allowed files
`apps/web/src/store/ChatStoreProvider.tsx`, `apps/web/src/store/effects/lifecycle.ts`, `apps/web/src/store/effects/chatActions.ts`, `apps/web/src/store/store.ts`, `apps/web/src/routes/LoginPage.tsx`, `apps/web/src/store/effects/switchUser.test.ts`, `work/T-1136-web-account-switch.md`.

### Checks
```bash
pnpm --filter @zilar/web exec vitest run src/store/effects/switchUser.test.ts src/store/effects/sendFailure.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- **The lead's local-stack repro passes:** with B signed in, `/login` goes to `/`; after signing out and in as A, the list is A's.

---

## Report (written by the worker when done)

## Review (written by Claude)
