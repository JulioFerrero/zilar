---
id: T-2126
title: "Plan only: store phase 3 — the app-side store wiring both apps still write twice (ports, lifecycle, history, chat actions, store shell); write docs/audit/store-phase3-plan.md with file:line facts, safe tasks and the expected line savings — no code change"
status: merged
milestone: M5
branch: task/T-2126-store-phase3-plan
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2126: Store phase 3 plan

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: the total must really go down, and the code must be easier for AIs and humans to read. Phase 2 (`docs/audit/store-phase2-plan.md`, tasks T-2115 to T-2117, merged) shared pins, prefs and group writes. It left out the parts next to the message path.

Both apps still keep their own wiring around the shared core in `packages/client-core/src/store/`. The lead counted at `b28e534bd`:

| Part | Web (`apps/web/src/store/`) | Phone (`apps/mobile/src/store/`) |
| --- | --- | --- |
| Ports (platform adapters, session check, session gone) | `effects/ports.ts` (507), `effects/portTypes.ts` (120) | `effects/ports.ts` (373) |
| Lifecycle (connect, focus, background, resume) | `effects/lifecycle.ts` (234) | `effects/lifecycle.ts` (370) |
| History load | `effects/history.ts` (248) | `effects/history.ts` (332) |
| Chat actions and send | `effects/chatActions.ts` (335) | `effects/send.ts` (167), `effects/events.ts` (193) |
| Store shell and context | `store.ts` (399), `realStore.ts` (102), `effects/storeContext.ts` (203), `effects/ctx.ts` (68), `effects/locals.ts` (73) | `real-store.ts` (478), `types.ts` (317), `effects/runtime.ts` (235), `effects/helpers.ts` (160), `effects/locals.ts` (71) |
| Provider | `ChatStoreProvider.tsx` (105) | `chat-store-provider.tsx` (241) |

These names exist in both apps:
- `checkSession` and `sessionGone`: web `effects/ports.ts:86,111`, phone `effects/ports.ts:122,157`;
- `resolvePorts`: web `:424`, phone `:295`;
- `createStoreLocals` (`effects/locals.ts`);
- `createRealChatStore`.

### What to write
Write one file, `docs/audit/store-phase3-plan.md`. Read the code; do not change any.

1. **Inventory.** For each part in the table:
   - what the shared core already offers (`packages/client-core/src/store/<file>.ts:line`);
   - what each app adds (`file:line`);
   - each difference, marked either:
     - **platform**: browser vs React Native (storage, visibility, app state, file bytes, voice, push), which must stay in the app behind a port; or
     - **same behaviour, different code**, which can move into core once.
2. **Tasks.** List tasks of about 30–60 minutes each, in a safe order. For each task give:
   - the core functions it adds;
   - the app files that shrink or go;
   - the exact Allowed files (full repo paths);
   - the existing tests that cover it;
   - the expected net line change.

   Never put two tasks on the same file at the same time, and say which tasks can run in parallel.
3. **Risks.** Mark every task that touches the message hot path: send, the ledger, incoming, history paging, reconnect. For each, say what could break (lost or duplicated messages, a stuck "connecting", wrong unread) and which tests guard it. List what the lead must check by hand after each task:
   - web mock screens by URL;
   - phone emulator routes;
   - a sign-out and sign-in.
4. **Total.** The expected line savings.

Keep the document under 400 lines. Use `file:line` for every claim.

### Allowed files
- `docs/audit/store-phase3-plan.md`
- `work/T-2126-store-phase3-plan.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The plan exists and cites `file:line` for every claim.
- Its tasks don't overlap and carry savings estimates and hot-path risk notes.
- No code changed.

---

## Report (written by the worker when done)

### What I did

Wrote `docs/audit/store-phase3-plan.md` (345 lines, under the 400 limit), with no code
changes. I read both apps' store files and the shared core store, and cited `file:line`
for every claim.

- Inventory covers all six parts in the spec table: ports, lifecycle, history, chat
  actions/send, store shell/context and provider.
- Differences are marked **platform** or **same behaviour, different code**. The send
  pipeline, incoming and the ledger are already in core and are explicitly left alone.
- 7 tasks of 30-60 minutes, each with the core functions it adds, the app files it
  shrinks, full Allowed files, the existing tests and a net line estimate. Parallel
  waves are stated with disjoint file sets.
- Risks mark the hot-path tasks (T2, T3, T4; T5 for sign-out) with the failure modes
  (lost/duplicated messages, stuck "Connecting…", wrong unread, cross-user leak) and
  the guarding tests. The manual checklist covers web mock URLs, phone emulator routes
  and a sign-out/sign-in after each task.
- Total: gross about -820/+480, **net about -337 lines** (±20%), with the shared
  session check, context/locals, history adapter/openChat, chat-list refresh, sign-out
  reset, cache writer and action/state types each ending up once in core.

Files changed:
- `docs/audit/store-phase3-plan.md` (new)
- `work/T-2126-store-phase3-plan.md` (Report and status only)

### Checks run

- `pnpm install --prefer-offline`: Done in 20.3s.
- `pnpm gate`: ended with `GATE PASS`.
- The gate summary lines were:
  - `gate: 2 changed file(s) against main`
  - `PASS  install (frozen)  (2.8s)`
  - `PASS  format  (1.6s)`
  - `PASS  lint  (1.9s)`
  - `PASS  typecheck  (1.7s)`
  - `SKIP effect (no source files changed)`
  - `SKIP build @zilar/server (no server, package or manifest change)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: no changed source file is over 800 lines`
  - `comments: no task IDs in added comments`
  - `GATE PASS`
- No single test file was run: this task changes docs only and `pnpm gate` ran typecheck
  across the repo; no package source changed, so there were no nearest tests.

### Notes for the lead

- The savings estimates are estimates, not measured refactors; every task is
  independent enough to be dropped if its measured diff is not a real reduction.
- T3 and T4 both touch `packages/client-core/src/store/history.ts` and are ordered
  sequentially (T3 then T4); they are not in the same wave.
- T6 is last because it touches both apps' `effects/lifecycle.ts` after T5.
- The plan deliberately leaves four things out and says so in section 4: the app API
  clients, the group/topic action types, the provider framework glue and the web-only
  sidebar helpers.

## Review (written by Claude)

Approved; the pre-review was clean (2 doc nits). `docs/audit/store-phase3-plan.md` (345 lines):
- inventories ports, lifecycle, history, chat actions, the store shell and the provider, with `file:line`;
- plans 7 tasks in 3 waves, about −337 net;
- gives a risk table and the manual checks for each task.

**Lead decisions:**
1. **Tonight** (Julio asleep): T7 (one action/state type surface, type-only) and T1 (one session check, test-guarded) run.
2. **Daytime:** T2 (core context: ledger, incoming, send), T3 (history), T4 (chat-list refresh), T5 (sign-out reset, security-sensitive) and T6 (cache writer, cold start). They wait until Julio is around: they need sign-out/sign-in and live message checks that a mock can't prove.
