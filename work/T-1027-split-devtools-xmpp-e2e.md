---
id: T-1027
title: "Size split T94: packages/devtools/src/xmpp-e2e.ts (457 lines) into xmpp-e2e/{harness,connect,muc,mam,main}.ts; one withDeadline"
status: merged
milestone: M5
branch: task/T-1027-split-devtools-xmpp-e2e
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1027: Split `xmpp-e2e.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `packages/devtools/src/xmpp-e2e.ts` is 457 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #90 (task T94). The new files go in a new `packages/devtools/src/xmpp-e2e/` folder: `harness.ts`, `connect.ts`, `muc.ts`, `mam.ts` and `main.ts`.

`packages/devtools/src/xmpp-e2e.ts` stays the entry, because `packages/devtools/package.json:8` runs `tsx src/xmpp-e2e.ts`. It keeps the header comment and starts the run.

- **In scope:** the in-file Dedup. One `withDeadline(timeoutMs, onTimeout)` replaces the settled-and-timeout boilerplate in `connect`, `waitForPresence` and `queryRoomMam`. Each keeps its own timeout value and error text.
- **Out of scope:** the `xmppErrorCondition` → xmpp-core item, because it crosses packages.

The run needs the dev stack, so nobody runs it in this task.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #90, and `packages/devtools/src/xmpp-e2e.ts`.

### Allowed files
`packages/devtools/src/xmpp-e2e.ts`, `packages/devtools/src/xmpp-e2e/harness.ts`, `packages/devtools/src/xmpp-e2e/connect.ts`, `packages/devtools/src/xmpp-e2e/muc.ts`, `packages/devtools/src/xmpp-e2e/mam.ts`, `packages/devtools/src/xmpp-e2e/main.ts`, `work/T-1027-split-devtools-xmpp-e2e.md`.

### Checks
```bash
pnpm --filter @zilar/devtools typecheck
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `packages/devtools/src/xmpp-e2e.ts` (457 lines) into a thin entry barrel plus a new
`packages/devtools/src/xmpp-e2e/` folder, following `docs/audit/split-rules.md` and
`docs/audit/size-plan.md` §2.2 #90. No behaviour change: code moved unchanged except the
in-file Dedup below.

Files:

- `packages/devtools/src/xmpp-e2e.ts` — the entry stays the entry: header comment + `main()`
  run, nothing else. `packages/devtools/package.json` still runs `tsx src/xmpp-e2e.ts`.
- `packages/devtools/src/xmpp-e2e/harness.ts` — `Runtime`, `errorMessage`, `sleep`,
  `loadEnvironment`, `websocketUrlFromApiUrl`, `xmppErrorCondition`, `collectGroupchat`,
  `sendGroupchat`, `waitUntil`, `STEP_TIMEOUT_MS`, and the new `Deadline`/`withDeadline`.
- `packages/devtools/src/xmpp-e2e/connect.ts` — `connect`, `expectLoginFails`.
- `packages/devtools/src/xmpp-e2e/muc.ts` — `waitForPresence`, `joinRoom` (+`MUC_NAMESPACE`).
- `packages/devtools/src/xmpp-e2e/mam.ts` — `MamMessage`, `queryRoomMam`
  (+`MAM_NAMESPACE`, `FORWARD_NAMESPACE`, `DELAY_NAMESPACE`, `DATA_FORMS_NAMESPACE`).
- `packages/devtools/src/xmpp-e2e/main.ts` — `main()` (the whole run).

### Dedup (in scope)

One `withDeadline(timeoutMs, onTimeout)` in `harness.ts` replaces the settled-flag +
`setTimeout`/`clearTimeout` boilerplate in `connect`, `waitForPresence` and `queryRoomMam`.
Each call keeps its own timeout value (`STEP_TIMEOUT_MS`) and its own error text; `connect`
passes an `onTimeout` that stops the client before rejecting, as before.

### Out of scope (not done)

`xmppErrorCondition` → xmpp-core `stanzaErrorCondition` crosses packages, so it stays in
`harness.ts` unchanged, as the spec says.

### Sizes (`wc -l`)

| file | lines |
| --- | --- |
| `packages/devtools/src/xmpp-e2e.ts` (old, `git show main:…`) | 457 |
| `packages/devtools/src/xmpp-e2e.ts` (barrel now) | 19 |
| `packages/devtools/src/xmpp-e2e/harness.ts` | 115 |
| `packages/devtools/src/xmpp-e2e/connect.ts` | 59 |
| `packages/devtools/src/xmpp-e2e/muc.ts` | 51 |
| `packages/devtools/src/xmpp-e2e/mam.ts` | 68 |
| `packages/devtools/src/xmpp-e2e/main.ts` | 197 |

Every new file and the barrel are well under 400 lines.

### Exports before and after

`grep -E "^export"` on the old file at `main` → **none** (it was a script). The barrel also
exports nothing, so `split-rules.md` item 3 is satisfied and no importer changes. The new
files export (the only added names are `withDeadline`/`Deadline`; everything else is a moved
function/type now exported so siblings can import it):

```
xmpp-e2e/harness.ts:9   export const STEP_TIMEOUT_MS
xmpp-e2e/harness.ts:14  export type Runtime
xmpp-e2e/harness.ts:19  export function errorMessage
xmpp-e2e/harness.ts:23  export function sleep
xmpp-e2e/harness.ts:27  export function loadEnvironment
xmpp-e2e/harness.ts:38  export function websocketUrlFromApiUrl
xmpp-e2e/harness.ts:44  export function xmppErrorCondition
xmpp-e2e/harness.ts:49  export function collectGroupchat
xmpp-e2e/harness.ts:60  export async function sendGroupchat
xmpp-e2e/harness.ts:69  export async function waitUntil
xmpp-e2e/harness.ts:79  export type Deadline
xmpp-e2e/harness.ts:88  export function withDeadline
xmpp-e2e/connect.ts:5   export function connect
xmpp-e2e/connect.ts:46  export async function expectLoginFails
xmpp-e2e/muc.ts:7       export function waitForPresence
xmpp-e2e/muc.ts:39      export async function joinRoom
xmpp-e2e/mam.ts:10      export type MamMessage
xmpp-e2e/mam.ts:12      export function queryRoomMam
xmpp-e2e/main.ts:21     export async function main
```

No file outside my Allowed files imports `xmpp-e2e` (the only reference is the
`package.json` script, unchanged), so no importer had to change.

### Commands run and real results

- `pnpm install` — `Done in 27.3s`, no lockfile change.
- `pnpm gate` (repo root) — summary:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (4.0s)
  PASS  format  (1.3s)
  PASS  lint  (1.8s)
  PASS  typecheck  (2.8s)
  PASS  effect  (1.9s)
  SKIP tests @zilar/devtools (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- The task's Checks list `pnpm --filter @zilar/devtools typecheck`; the run instructions say
  to run the format/lint/typecheck set once through `pnpm gate`, so I did not run it
  standalone. To confirm the gate really typechecked this package, a `turbo run typecheck
  --affected --dry` (with `TURBO_SCM_BASE=main`) lists `@zilar/devtools#typecheck` in scope,
  and the gate's `typecheck` step passed.
- No single test file was run: `packages/devtools/src` has no test directly next to the
  changed files, so the gate skipped `tests @zilar/devtools`. Per `split-rules.md` item 5, I
  wrote and edited no test.

### Effect ratchet

`packages/devtools/` is an exempt path (`effect-map/generate.ts` `EXEMPT_PATHS`), and the
gate's `effect` step passed. No `// effect-plain:` marker was added.

### Deviations / notes

- The plan's line ranges overlap (`52–57` is in both the harness and the connect entry). I
  put `websocketUrlFromApiUrl` in `harness.ts` (its listed `29–57` range); `main` is its only
  caller anyway.
- Namespace constants: `MUC_NAMESPACE` lives in `muc.ts`, the four MAM-related ones in
  `mam.ts`, `STEP_TIMEOUT_MS` in `harness.ts` (shared by all).
- Only formatting: one long line in `connect.ts` was wrapped by Prettier.

### Problems / open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `xmpp-e2e.ts` (457 lines) stays the 19-line entry for `pnpm xmpp:e2e`, plus `xmpp-e2e/{harness,connect,muc,mam,main}`. The largest is `main.ts` at 197.
- **The dedup:** one `withDeadline` replaces the settled-and-timeout boilerplate in three places.
- **The lead read `connect` against main:** the timeout, error, online and start-failure paths each settle once, with the same messages, and the timeout still stops the client.
- **Not run:** the e2e itself, because it needs the dev stack.
- **Check:** the gate passed.
