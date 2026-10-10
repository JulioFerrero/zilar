---
id: T-0896
title: "Store core design: a verified plan and task split for one platform-free chat store in packages/client-core (simplify plan 4.3)"
status: merged
milestone: M5
branch: task/T-0896-store-core-design
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0896: Store core design

## Spec (written by Claude, do not edit)

### Why
Phase 4.3 of `docs/audit/simplify-plan.md` is the largest remaining cut, about 5k lines. Web (`apps/web/src/store/realStore.ts`, 1,550 lines, plus `apps/web/src/store/effects/*`) and mobile (`apps/mobile/src/store/real-store.ts`, 1,827 lines, `chat-store.ts`, 1,595 lines, plus `apps/mobile/src/store/effects/*`) implement the same chat store twice.

The audit finding is `docs/audit/simplify-2026-10-09/A-web-mobile.md`, section F6. Its line numbers are from 2026-10-09, and waves 3 to 5 moved code since:
- T-0877 put six ledger helpers into `packages/chat-core/src/store/ledger.ts`;
- T-0878 created `packages/client-core`;
- T-0884 created `createFakeXmppCore`;
- wave 5 derived the API clients from `packages/api-contract`.

This task writes the plan only. **No code changes.**

### What to write: `docs/STORE_CORE_PLAN.md`
Every claim in the plan cites a current `file:line` you read.
1. **Inventory.** For every store module on both sides (web `effects/*.ts`, `realStore.ts`, `store.ts`, `ctx.ts`; mobile `effects/*.ts`, `real-store.ts`, `chat-store.ts`, `types.ts`), give:
   - its exports;
   - its counterpart on the other side;
   - the differences that matter: behaviour, state shape, lifetimes, platform calls.

   Mark each difference as "same behaviour, different code", "web-only feature", "mobile-only feature" or "real behaviour difference". For the last kind, recommend which side wins and why; it becomes a question for Julio only if it changes what a user sees.
2. **One lifetime design.** Web uses a store Scope plus `FiberSet`/`FiberMap` (`apps/web/src/store/effects/runtime.ts`). Mobile uses session and generation Scopes with `Effect.forkIn` (`apps/mobile/src/store/effects/runtime.ts`). Pick one, with reasons grounded in the tests that pin it.
3. **The ports.** Write a TypeScript sketch of the `Ports` the core needs (API, XMPP, bytes and upload, voice, storage, visibility and app state, drafts SSE, navigation, badge, clock if needed), mapped to today's web and mobile implementations.
4. **Target layout.** List the modules for `packages/client-core/src/store/`, with estimated lines, and what stays in each app as an adapter.
5. **Migration order and task split.** Write 6-10 tasks, each one shippable and green on its own.
   - Use the current `StoreApi`/`createRealChatStore(deps)` facades, so the existing store tests (about 16k lines) guard each step unchanged.
   - For each task, give the exact files it touches on web, mobile and core, the tests that guard it, its risk, and which tasks can run in parallel with disjoint files.
   - Name the first, smallest, safest pilot.
6. **Risks.** Cover the hot paths: send echo matching, history paging, reconnect and resume, and typing. Say which existing tests cover each, and where coverage is missing so a task must add tests first.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/<task id>/`), `docs/audit/simplify-plan.md` (Phase 4), `docs/audit/simplify-2026-10-09/A-web-mobile.md` (F1, F3, F6, F7), `packages/client-core/src/*`, `packages/chat-core/src/store/ledger.ts`, and both store folders.

### Allowed files
`docs/STORE_CORE_PLAN.md`, `work/T-0896-store-core-design.md`.

### Checks
`pnpm exec prettier --check docs/STORE_CORE_PLAN.md`

### Acceptance
- The plan exists, with every claim cited.
- The task split has disjoint file lists and a named pilot.
- No code file changes.

---

## Report (written by the worker when done)

**What I did:** wrote `docs/STORE_CORE_PLAN.md` (428 lines) after reading both store folders, `packages/client-core/src`, `packages/chat-core/src/store/ledger.ts`, both app ports and providers, the audit (F1, F3, F6, F7) and simplify plan Phase 4. Every line number is from commit `aa7cf979`. No code changed.

**Files changed:** `docs/STORE_CORE_PLAN.md` (new), this task file.

**Plan in short:**
- **Lifetime:** web's `makeLifetime` (store Scope, child session Scope per boot attempt, `FiberSet`/`FiberMap`). Mobile's `session`/`generation` map one to one onto store/session. Reasons from the tests: both pin inline start (`web runtime.test.ts:19-25`, `mobile runtime.test.ts:20-21`); mobile's two Scope tests map onto web's (`:58-72`, `:27-40`); the keyed runner (`:42-56`) replaces five hand-kept timer maps on mobile; failed forks are logged (`:74-85`). The core adds from mobile: `fork` returns the fiber (boot dedupe), `onClose`, `isOpen`, and a test that no rollback runs on interruption.
- **Pilot:** T1, the `@zilar/client-core/store` subpath plus 8 verbatim pure helpers (`sortByRecency`, `moveChatToTop`, `sortMessages`, `advanceStatus`, `clearFailure`, `coreKind`, `rememberFinishedDraftMessage`, `withoutDraft`). It proves the package wiring on Metro and both vitest setups with no behaviour change.
- **Tasks:** 10, in 6 waves (T2∥T3, then T4∥T5∥T6, then T7∥T8). Each core module comes out of web first behind the unchanged facade; mobile adopts it in its own task. Phase 2 (pins, prefs, folders, groups, shared `ChatEntry`, state names, mocks) is listed but not split.
- **Real behaviour differences found (20, section 2.3).** The ones that matter most: mobile never maps the mentions of a received message (`real-store.ts:1348-1411` vs `realStore.ts:1146-1149`); mobile voice/attachment/forward failures have no failed status and no 60 s deadline; mobile never retries a failed XMPP connect until a resume; web lacks mobile's `linkLocalToServer` root fix; mobile's sticker retry leaves a stale echo-queue entry; web restores the original text on a reverted edit and mobile cannot.
- **Audit corrections:** F1a and F1c are fixed on main; F1b is wrong about text: web text sends also stay `sending` on failure (`web/effects/send.ts:427-428`), so D-1 already holds on both apps. Store tests are 14.9k lines, not 16k.

**Commands:**
- `pnpm install --frozen-lockfile --prefer-offline` (the worktree had no `node_modules`): done, no tracked file changed.
- `node --input-type=module -e ...` probe from `apps/web`: `Effect.catchCause` and `Effect.catch` do not run their handler when a fiber is interrupted from outside (effect 4.0.2). Cited in section 3 as a probe, not as a repo test.
- `pnpm exec prettier --check docs/STORE_CORE_PLAN.md`: "All matched files use Prettier code style!"
- I did not run `pnpm gate`: `docs/EFFECT_BRIEF.md` says wave workers leave it to the lead, and this task changes no code.

**Open questions (for Julio, section 8 of the plan):** Q1 received @mentions highlighted on mobile; Q2 mobile voice/attachment/forward "Not sent" after 60 s; Q3 mobile connect retry with backoff; Q4 one set of pin error texts and clearing a stale error banner on the next send on web.

**Open points for the lead:** Metro resolving the new `./store` subpath is unverified until T1's `phone:smoke`. Mobile keeps `messagesByChat` across `stop()` and one store instance across sign-ins (`real-store.ts:1757-1773`, `chat-store-provider.tsx:64-85`); I did not check on a device whether a second user can see the first user's messages. The `sendFailureReasonFor` and `voiceFailureReasonFor` tables were not compared; T10 should.

## Review (written by Claude)

**Lead, 2026-10-10: approved.**
- **The plan:** `docs/STORE_CORE_PLAN.md` is cited throughout. It has one lifetime design (web's), a ports sketch, 10 tasks in 6 parallel-safe waves, and T1 as a small pilot.
- **Corrections to the audit:** F1a and F1c are already fixed, and F1b is wrong.
- **Questions:** the lead decided Q1-Q4 as recommended while Julio slept. They are recorded in section 8 and can each be reverted with a flag or a text change.
- **Mobile sign-out finding:** I confirmed it in code. `teardown()` (`apps/mobile/src/store/real-store.ts:1757-1773`) keeps `chats`, `contacts`, `messagesByChat` and `me`, and the provider keeps one store across sign-ins (`apps/mobile/src/store/chat-store-provider.tsx:64-85`). The next user's boot replaces `chats` and `contacts`, but `messagesByChat` is keyed by chat JID. T-0901 fixes it, tests first.
- **Merge:** docs only, so it merges without the gate.
