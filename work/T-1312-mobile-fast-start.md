---
id: T-1312
title: "Mobile fast start: with a stored token and a cached profile, open the app at once and check the session in the background (a 401 still signs out); measure and report where cold-start time goes; tested"
status: merged
milestone: M5
branch: task/T-1312-mobile-fast-start
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1312: Open at once on a stored session (mobile)

## Spec (written by Claude, do not edit)

### Why
Lead's measurement, 2026-10-13, release APK from main at `f9b833c` on the emulator, signed in as Claude Test:
- **Cold start to the chat list:** **12 s online, 16 s offline**.
- **At 8 s online,** the screen still showed `LoadingScreen` ("Loading…", `apps/mobile/src/auth/RequireAuth.tsx:17-24`).
- **Telegram** opens in about 1 s.

**The cause in the code:**
- `bootstrap` (`apps/mobile/src/auth/session-store.ts:146-168`) reads the token and the cached profile (`readStoredMe`, `:141-143`), then **waits for `loadMe`** (`:157-162`) before it leaves `loading`.
- **Online,** that's a full `/api/me` round trip.
- **Offline,** it waits until the first fetch fails, then `onOffline` sets `offline` with the stored profile.
- `RequireUser` shows `LoadingScreen` the whole time (`RequireAuth.tsx:30-32`).
- The font wait is capped at 1 s (`apps/mobile/src/app/_layout.tsx:40,72-88`), so it isn't the cause.

### What to build
1. **Optimistic start:** in `bootstrap`, when a token AND a stored profile exist, set the signed-in state with the stored `me` **before** calling `loadMe`. Use whichever status the guard already treats as signed in with a user; cite `apps/mobile/src/auth/guard.ts`. Then run `loadMe` in the background:
   - success: store and set the fresh `me`;
   - 401: clear the token and go `guest` (unchanged);
   - a transient failure: stay in the app (T-1304 behaviour).
   With a token but no stored profile, keep today's behaviour.
2. **Measure:** add timing marks in dev builds only (`__DEV__`):
   - app start, fonts ready, session state, first chat-list render, XMPP online.
   Put the numbers from one emulator cold start in the Report, and name the largest remaining step. **Don't fix that other step here;** just report it.
3. **Tests** (auth), up to 3, in `apps/mobile/src/auth/session-store.test.ts`:
   - token plus stored me: signed in before `fetchMe` resolves;
   - a background 401 then goes `guest` and clears the token;
   - a token with no stored me still waits (`loading`).

### Read first
`AGENTS.md`, `apps/mobile/src/auth/session-store.ts`, `apps/mobile/src/auth/guard.ts`, `apps/mobile/src/auth/RequireAuth.tsx`, `apps/mobile/src/app/_layout.tsx`, and the T-1304 task file (`work/T-1304-stay-signed-in-on-errors.md`).

### Allowed files
`apps/mobile/src/auth/*.ts`, `apps/mobile/src/auth/*.tsx`, `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/lib/startup-timing.ts`, `work/T-1312-mobile-fast-start.md`.

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run src/auth --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass. Every file stays at most 400 lines (`real-store.ts` is 367).
- **The lead's check:** a release APK cold start shows the chat screen within about 3 s on the emulator, online and offline.

---

## Report (written by the worker when done)

**Status: review.**

### What I did

**1. Optimistic start — `apps/mobile/src/auth/session-store.ts`**

`bootstrap` has two branches now:
- **Token + stored profile:** set `{ status: 'authenticated', me: storedMe }` **before** calling `loadMe`, so the guard lets the app through at once. `authenticated` is the status `guardDecision` treats as signed in with a user (`guard.ts:27-30`, the same branch as `offline` with a known name). `loadMe` then runs behind the app: success stores and sets the fresh `me`; a 401 clears the token and goes `guest`; a transient failure sets `offline` and keeps the user in (T-1304).
- **Token, no stored profile:** today's code path, unchanged (still `loading` until the first `loadMe` settles).

Because the optimistic branch paints a stored user, a background refresh that outlives its session could otherwise resurrect a signed-out account (or overwrite a new sign-in): a `sessionRun` counter is bumped on sign-out and sign-in, and the optimistic branch drops its `onOffline`/success/401 writes when the run is stale. The no-stored-profile branch is untouched, per the spec.

**2. Dev-only cold-start marks**

- New `apps/mobile/src/lib/startup-timing.ts`: records the first occurrence of `app-start` (at module load), `fonts-ready`, `session`, `chat-list`, `xmpp-online` and logs `[startup] <mark> +<ms>ms` since app start. All behind `__DEV__`, read through `typeof` so Vitest never throws; `startupTimingEnabled()` exposes the flag.
- `apps/mobile/src/app/_layout.tsx`: marks `fonts-ready` in the effect that hides the splash.
- `apps/mobile/src/auth/session-store.ts`: marks `session` when `bootstrap` first leaves `loading`.
- `apps/mobile/src/store/real-store.ts`: subscribes once (only when `startupTimingEnabled()`) and marks `chat-list` on the first `chatsLoad === 'loaded'` — the first list with rows on screen — and `xmpp-online` on the first `status === 'online'`.

**3. Tests — `apps/mobile/src/auth/session-store.test.ts`, +3**

- token + stored me: `authenticated` with the stored profile while `fetchMe` is still pending, then the fresh profile replaces it and is persisted;
- a background 401 goes `guest` and clears the token and the cached profile;
- a token with no stored me still stays `loading` until the profile arrives.

### Files changed (all inside Allowed files)

- `apps/mobile/src/auth/session-store.ts`, `apps/mobile/src/auth/session-store.test.ts`
- `apps/mobile/src/app/_layout.tsx`
- `apps/mobile/src/store/real-store.ts` (384 lines, `< 400`)
- `apps/mobile/src/lib/startup-timing.ts` (new, 43 lines)
- `work/T-1312-mobile-fast-start.md`

No new dependency.

### Commands I ran (real results)

- `pnpm install` → done in 15.8s (peer warning only: `@types/react-dom` wants `@types/react@^19.3.0`).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/auth/session-store.test.ts` → **1 file, 13 passed** (10 before + 3 new).
- `pnpm --filter @zilar/mobile exec vitest run src/auth --reporter=dot` (the task's Checks command) → **6 files, 57 passed**.
- `pnpm gate` (repo root) → **GATE PASS**, 6 changed files, every one inside the Allowed files:

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.2s)
PASS  lint  (0.8s)
PASS  typecheck  (3.4s)
PASS  effect  (0.7s)
PASS  tests @zilar/mobile  (3.2s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Measurement — NOT performed (honest gap)

The spec asks for the numbers from one emulator cold start. **I did not run one.** The marks are `__DEV__`-only, so they need a **dev** build; building one means `expo prebuild` + a Gradle debug build, which would create `apps/mobile/android/**` in this worktree and use a large amount of the shared machine. The provided `pnpm phone:install` / `pnpm phone:smoke` scripts build in the **shared** build worktree `$HOME/personal-projects/zilar-phone-build` (they `git checkout` there and install over the one shared emulator), which other workers may be using in parallel — so I did not touch it. I also did not start a Metro/dev server (background processes are forbidden by AGENTS.md).

What the marks will give a dev-build run, in this order: `app-start` → `fonts-ready` → `session` → `chat-list` → `xmpp-online`; `session` is the new early point (the fix), so the gap between `app-start` and `chat-list` is what the lead should read.

**Largest remaining step (from reading the code, not measured):** with the fix, `session` no longer waits for `/api/me`, so the remaining wait before the list appears is (a) the JS bundle load + first render up to `fonts-ready` (font wait capped at 1 s, `_layout.tsx:40`) and (b) the store boot painting the cached list — `prepareStart` paints `readChatListCache()` before `/api/chats` answers (`effects/lifecycle.ts:120-133`). A cold start with no cached list waits on `/api/chats`, then `xmpp-online` follows the XMPP connect. I flag this as analysis to be confirmed by the lead's dev-build run.

### Security checklist

Tokens/secrets: no new logging of the token; the cached profile carries no token and is still cleared with the token on 401/sign-out (the existing "never logs the session token" test passes). No routes, no `where`, no caps/uniqueness changes. Sign-out cannot be undone by an in-flight background refresh (`sessionRun`). Nothing outside the Allowed files.

### Deviations / notes

- The `sessionRun` guard is an addition beyond the letter of the spec; it protects the new optimistic path from resurrecting a signed-out session. The no-stored-profile branch is unchanged as required.
- "First chat-list render" is measured at the store's first `chatsLoad === 'loaded'` (the first list with rows on screen) because `components/chat/chat-list.tsx` and `app/(tabs)/index.tsx` are outside the Allowed files. The earlier skeleton paint is not separately marked.

### Round 2 (fix round)

**Findings from PREREVIEW.md:** must-fix=0, should-fix=1, nit=3.

- **should-fix 1 — no cold-start measurement (spec item 2 unperformed): needs the lead's decision, so `status: blocked`.** I cannot produce the numbers the spec asks for from this session, and the missing piece is a choice only the lead/owner can make (run the dev-build measurement, or explicitly waive spec "What to build" #2). Details below.
- **nit 1 (`session-store.ts:167`, optimistic `authenticated` with a nameless stored profile), nit 2 (`session-store.ts:214`, `signIn` bumps `sessionRun` before `verifyCode`), nit 3 (`session-store.ts:193-207`, the no-stored-profile branch never checks `sessionRun`) — left untouched.** Per the instructions, nits are only touched when they fall in a line a fix already changes; no fix changed any of those lines. The pre-reviewer marks all three unreachable/theoretical.

**Why the measurement cannot be produced here (honest gap, unchanged from round 1 — now confirmed):**

1. The marks are `__DEV__`-only (`apps/mobile/src/lib/startup-timing.ts:10`; `markStartup` returns early unless `DEV`). A release APK has `__DEV__` folded to `false`, so it logs nothing.
2. The two sanctioned phone scripts build **release** (`scripts/phone/install.sh:58,68` → `assembleRelease`; `scripts/phone/smoke.sh` calls it), so neither can surface the marks. There is no sanctioned dev-build measurement path.
3. A dev build would require `expo prebuild --platform android` plus a Gradle debug build and a running Metro bundler. Metro is a long-running background process, forbidden by AGENTS.md ("Never start daemons, background jobs or detached runs"); `prebuild` would also create `apps/mobile/android/**`, which is outside this task's Allowed files and would make `pnpm gate` report files outside scope. Building it in the shared build worktree (`$HOME/personal-projects/zilar-phone-build`) would `git checkout --detach` that worktree, which other workers may be using.
4. The spec's scenario is "signed in as Claude Test" on the emulator. The running emulator (`emulator-5554`) currently has no `app.zilar.chat` installed, so there is no stored session to reproduce, and I have no account credentials (and must not handle real ones). I confirmed `adb shell pm list packages` shows no zilar package.

I also re-checked the mark wiring for a code-side defect that could explain a missing measurement; there is none: `_layout.tsx` marks `fonts-ready` when the splash hides, `session-store.ts` marks `session` when `bootstrap` first leaves `loading` (both the guest and the optimistic/no-profile branches — note the guest branch marks it, and both non-guest branches mark it once), and `real-store.ts` marks `chat-list` on the first `chatsLoad === 'loaded'` and `xmpp-online` on the first `status === 'online'`. The wiring matches the spec.

**What is needed to unblock:** the lead either (a) runs one dev-build cold start (dev build + Metro) signed in as Claude Test and pastes the `[startup] …` lines here, or (b) explicitly waives spec item 2. No code change in this round; nothing in the source is wrong for the goal (the opening behaviour is the part the tests already cover).

**Gate (this round):** no source files changed, so the code gate cannot regress. See the command output below.

## Review (written by Claude)

**Lead, 2026-10-13: approved. The worker's block is resolved: the lead waives spec item 2.** The marks are dev-only and the phone scripts build release, so the lead times the release APK cold start after the merge instead.
- **The change:**
  - with a token and a stored profile, `bootstrap` sets `authenticated` at once, then refreshes in the background;
  - a 401 still clears the token and goes `guest`; a transient failure goes `offline` with the user kept;
  - the `sessionRun` counter stops a stale refresh from writing after a sign-in or sign-out.
- **Nits 1–3 left as they are:** a nameless stored profile goes through the name step as before.
- **Lead's checks after the rebase:** mobile `src/auth`: 57 tests pass; mobile tsc: 0 errors. `real-store.ts` is 384 lines.
- **Order:** merge before T-1313, which also edits `real-store.ts`.
