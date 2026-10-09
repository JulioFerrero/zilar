# The plan to a 100% Effect codebase

Status: audit (T-0753), 2026-10-09. Docs only. Every number was measured at commit `19a769a9` (main, the base of this branch) by a throwaway script that is not committed (section 1.5 holds its core, so the map task R1 can port it). Every claim about the code cites `path:line`. Anything I could not check is marked "unverified" and listed again in section 7.

## 0. Summary

- **Today:** 196 of 829 counted source files import Effect, which is **38.3%** of the lines outside the exempt list (68,206 of 178,096). The old table in the task spec says 198 of 848 files and 36%; the gap is the scope fix in section 1.4 (fixtures and test helpers are not product code), the exempt list, and merges since the spec was written.
- **What "100%" means:** not "every file imports Effect". A pure helper or a pure React component may stay plain. The rule is: a file that does I/O, waits, can fail in a way the caller must handle, or holds shared state must use Effect. A script can check it (section 1.4).
- **The gap by that rule:** **271 files, 82,143 lines** use async code, timers, storage, try/catch, JSON parsing or env reads without Effect. By that measure Effect covers **45.4%** (Effect lines / (Effect lines + failing lines)). Mobile has 119 of those files, web 86, devtools 21, server 37.
- **The plan:** **118 tasks, 54.5 worker-days**, in 6 phases (section 4). Median task is 0.25 to 0.5 day, one folder. 37 tasks need a look from Julio (new dependency, or a risk on login, messaging, push, deploy or the lead loop).
- **Order:** rule and markers, then shared foundations and `xmpp-core`, then server and tooling in parallel, then web, then mobile (web first, as the atom plan says).
- **Projection:** coverage goes 45.4% to 46.6% (rule and markers), 47.3% (foundations, xmpp-core), 56.8% (server, tooling), 77.1% (web), **100.0%** (mobile). The old "imports Effect" measure ends near 77% because pure files legitimately stay plain.
- **Decisions needed from Julio:** section 6 (nine items; the two that change the size of the plan are D2 `apps/site` and D7 `packages/devtools`).

## 1. The definition of 100%

### 1.1 Decisions this builds on (not reopened)

| Decision | Where it is recorded |
| --- | --- |
| The whole codebase moves to Effect 4.0; Effect Schema replaces zod; `effect/sql` replaces drizzle; Effect HTTP replaces Hono; `@effect/atom-react` replaces zustand; mobile converts now and the +2.8 MiB bundle is accepted. | `docs/ROADMAP_EFFECT.md:5-16` |
| Zustand is gone: `@effect/atom-react` owns state, one registry per provider, `start()`/`stop()` become Effect programs. This supersedes the "keep zustand" advice. | `docs/audit/effect-atom-react-plan.md:7-11`, `:289-361`; superseded text `docs/audit/effect-everywhere-plan.md:287-307` |
| A module may export plain `Promise` functions with Effect inside, `Effect.runPromise` only at the edge. Kept for modules that have not been through the edge flip. | `docs/EFFECT_GUIDE.md:12-32`; `docs/audit/effect-everywhere-plan.md:602-604` |
| One tagged error class per failure mode; no secrets, URLs or provider text in errors. | `docs/EFFECT_GUIDE.md:61-72` |
| One runtime per process; logging goes through the pino layer so redaction holds. | `docs/EFFECT_GUIDE.md:178-189`; `docs/audit/effect-everywhere-plan.md:337-352`, `:582-584` |
| Loops need `catchDefect`, timers need interrupting on shutdown, `timeoutOrElse` beats `timeout`. | `docs/EFFECT_GUIDE.md:165-170` |
| Mobile API clients: Schema decode, `Effect` pipeline, `Promise` at the edge, `expo export` plus `pnpm phone:smoke` as proof. | `docs/EFFECT_GUIDE.md:235-243` |
| Web goes first, mobile follows the web pattern. | `docs/audit/effect-atom-react-plan.md:366-367` |
| Hermes has no `crypto.subtle`; `WeakRef` users need an on-device check. | `AGENTS.md:52`; `docs/audit/effect-atom-react-plan.md` section 6 ("Hermes"); `docs/audit/effect-everywhere-plan.md:309-335` |
| Tasks are about 400 changed lines or less; S is up to 0.5 day, M is 1 to 2 days. | `docs/audit/effect-atom-react-plan.md:365-367` |

Two texts are stale and the plan does not follow them: the "What NOT to do" list in `docs/EFFECT_GUIDE.md:255-266` (zod stays, no services or layers) is overridden by `docs/EFFECT_GUIDE.md:251-253`, and `AGENTS.md:41` still tells workers to validate with `zod`, which no file imports any more. Task Z2 fixes the guide; `AGENTS.md` is the lead's to change (a worker may not edit it).

### 1.2 The rule in plain English

A file is done when **either** it uses Effect for everything that can wait, fail or touch the outside world, **or** it has nothing of that kind in it.

| Must use Effect | May stay plain |
| --- | --- |
| Network: `fetch`, WebSocket, SSE (`apps/web/src/lib/api.ts:253`) | Pure functions with no failure mode: all of `packages/chat-core` (16 files, 1,571 lines, no signal at all) |
| XMPP and any other long-lived connection (`packages/xmpp-core/src/client.ts:209`) | Parsers and builders: `packages/xmpp-core/src/stanza.ts` (1,079 lines), `jid.ts`, `mam.ts`, `namespaces.ts` |
| Storage and files: `localStorage`, AsyncStorage, SecureStore, `node:fs` | Types, constants and tokens: `packages/ui-tokens/src/index.ts`, `packages/protocol/src/version.ts` |
| Async control flow and concurrency: `async`/`await`, `Promise`, timers, polling loops | Pure presentational React components: `apps/web/src/components/ui/button.tsx` (65 lines) |
| Typed errors: `try`/`catch` that decides what to show or retry | React glue that only renders atoms and local `useState` (open/closed, input text) |
| Resources with a lifetime: sockets, workers, recorders, subscriptions | Generated files and fixtures |
| Decoding input: `JSON.parse` of anything that came from outside (Schema) | Dev-only mock backends, kept apart (section 1.4, exempt list) |
| Shared and app state: atoms, not module-level `let` or `Map` caches | |
| Config and env reads, logging | |

### 1.3 What the rule does to React

A component stays plain while it renders and keeps local UI state. It becomes non-compliant the moment it contains `async`, `await`, `.then`, `try`/`catch` or a timer, because that is async control flow with no cancellation. Example today: `apps/web/src/components/GroupPanel.tsx:118-150` sets a `busy` flag, awaits an API call and catches into an error string, and it has 10 `try` blocks like it in one file. The fix is one hook, `useAction`, so a component has no async code of its own (section 3.6). Components that already call only store actions and render stay plain.

### 1.4 How a script checks it

This is the part the map task (T-0752, `packages/devtools/src/effect-map/`) implements. T-0752 ports the old generator, whose file filter and import regex are at `/Users/julio/.claude/jobs/fcd95e40/tmp/effect-map/gen.mjs:13-24`; this section adds the second axis. Task R1 does it.

**Scope.** `git ls-files` for `*.ts` and `*.tsx` under `apps/`, `packages/` and `scripts/`, minus:

- tests and specs (`.test.`, `.spec.`, `/test/`, `__tests__`), `.d.ts`, Cosmos files (`.cosmos.`), `fixtures`, `test-tables` (the old filter, `gen.mjs:13-16`);
- Cosmos fixture files (`.fixture.`) and test helpers that live in `src/`: `test-harness.ts` (`packages/runner-tunnel/src/test-harness.ts`, used by 4 test files), `test-support.ts`, `fake-*.ts` (`packages/agent-drivers/src/fake-opencode-server.ts`). **New in this plan.**

**Class of a file** (first match wins):

1. **exempt**: the path is under `/mock/`, ends in `-mock.ts` or `.config.ts`, is under `apps/mobile/{ios,android,scripts}/` or `apps/site/` (decision D2), **or** the first 15 lines hold a marker comment `// effect-plain: <reason>`. The map prints every marker file with its reason and fails if there are more than 25 (today 0; the plan adds about 16).
2. **effect**: it has a value import from `effect`, `effect/*` or `@effect/*`. `import type` does not count. (Today none of the 196 files is type-only.)
3. **needs-effect**: not exempt, not effect, and it matches at least one signal below.
4. **plain**: everything else.

**Signals.** Strings and comments are blanked first; each regex runs per line.

| Id | Signal | Regex | Known false positives and how to handle them |
| --- | --- | --- | --- |
| H1 | async control flow | `\basync\b`, `\bawait\b`, `\bnew Promise\b`, `\.then\(`, `\bPromise\.(all\|allSettled\|race\|any\|resolve\|reject)\b` | A type like `Promise<void>` in an interface is **not** matched (needs `new Promise` or `Promise.x`). The word `async` inside a template-literal text is not blanked (none found; unverified). Lazy `await import('expo-audio')` (`apps/mobile/src/lib/voice-native.ts:165`) is a real hit: use `Effect.promise(() => import(...))`. |
| H2 | network | `(?<![\w.$])fetch\(`, `XMLHttpRequest`, `new (WebSocket\|EventSource)`, `sendBeacon\(` | `this.fetch(` is not matched (method call). An injected `fetchImpl(` is not matched, so `apps/mobile/src/lib/*-api.ts` (which take `fetchImpl: typeof fetch = fetch`, `pins-api.ts:131,165`) rely on being Effect files. |
| H3 | timers | `(setTimeout\|setInterval\|setImmediate\|requestIdleCallback)\(` | `requestAnimationFrame` is deliberately not counted (render scheduling). A tiny debounce hook (`apps/web/src/lib/useDelayed.ts`, 22 lines) is a real hit; fix it once and its users stay clean. |
| H5 | storage | `\b(localStorage\|sessionStorage\|AsyncStorage\|indexedDB)\b` | A `storage: Storage \| null` parameter (the web store takes one, `realStore.ts:770`) is not matched; only the global names are. |
| H8 | node I/O import | `import ... from` `node:fs`, `fs/promises`, `child_process`, `net`, `http`, `https`, `http2`, `os`, `worker_threads`, `dgram`, `dns`, `tls`, `readline`, `stream`, `zlib` (with or without `node:`) | `node:net` imported only for `isIP` (`apps/server/src/sandbox/ip-guard.ts:1`) is pure: use a marker. `node:path`, `url`, `util`, `buffer` and `crypto` are not matched. Known miss: `node:crypto` `randomBytes` and `Math.random` / `Date.now` are impure but synchronous; not counted. |
| H9 | native I/O import | imports of `expo-(file-system\|secure-store\|notifications\|av\|audio\|image-picker\|document-picker\|media-library\|camera\|contacts\|clipboard\|sharing\|location\|haptics\|crypto)`, `@react-native-async-storage/async-storage`, `react-native-mmkv` | `expo-haptics` is fire-and-forget; it still counts (one file, `swipe-to-reply.tsx:1`, also has a weak hit). |
| W4 | try/catch | `\btry\s*\{`, `\.catch\(`, `\bcatch\s*[({]` | **Most common false positive:** `try { new URL(x) } catch` is a pure total parse (7 files: `apps/web/src/components/MarkdownText.tsx:14`, mobile `lib/markdown.ts`, `lib/attachments.ts`, `lib/gifs.ts`, `lib/topics.ts`, `components/settings/profile-logic.ts`, `components/chat/attachment-body.tsx`). Same for `decodeURIComponent` (`apps/web/src/routes/ChatShell.tsx:16`) and `String.fromCodePoint` (`apps/server/src/web-tools/html.ts:161`). Also `try/finally` that only unwinds a Set (`apps/server/src/actions/canonical.ts:56`) and listener isolation (`apps/server/src/groups/events.ts:22`). Handle with the shared helper (task R3) or a marker. |
| W6 | JSON.parse | `\bJSON\.parse\(` | Parsing a constant is fine; parsing input must use Schema. `apps/server/src/version.ts:4` reads `package.json` at startup (task S7). |
| W7 | env read | `\bprocess\.env\b`, `\bimport\.meta\.env\b`, `\bEXPO_PUBLIC_\w+` | Expo only inlines a literal `process.env.EXPO_PUBLIC_*` expression (`apps/mobile/src/lib/auth.ts:19-22`), so mobile may not hide the read behind `Config`. Allowed: one read per app, in an exempt file (`apps/mobile/src/mock/gate.ts`, task R5). `vite.config.ts` is exempt as a `*.config.ts`. |

H = hard signal, W = weak signal. Both make a file `needs-effect`; the split exists because weak hits are mostly cheap to clear (a helper or a marker) and the map should show them apart (`needs-weak`: 43 files, 6,406 lines).

**Legacy rule (L).** Any import of `zod`, `drizzle-orm`, `hono`, `@hono/*` or `zustand` fails. Today there are none: `rg "from '(zod|drizzle-orm|hono|@hono|zustand)"` over `apps`, `packages` and `scripts` returns nothing (the only drizzle text left is the lockfile, 27 lines in `pnpm-lock.yaml`, which `work/NOW.md` explains as better-auth's optional peer).

**Definition of 100%.** The codebase is 100% Effect when all four hold: (1) no `needs-effect` file; (2) no legacy import; (3) every marker file has a one-line reason and there are at most 25; (4) the map's coverage, **Effect lines / (Effect lines + needs-effect lines)**, reads 100.0%. This is the target metric used in section 5.

**Tier B: tracked, not part of 100%.** An Effect file that still contains a hard signal is a "Promise edge" (`export async function` wrapping an Effect, or `await` inside `Effect.promise`). `docs/EFFECT_GUIDE.md:12-32` allows these. Today there are **130 files, 56,537 lines** (server 91, mobile 25, devtools 5, web 3, runner and tunnel 5, agent-drivers 1). The ratchet in task R6 lets this number fall and never rise; whether to demand zero is decision D1. Appendix B outlines the optional Phase 6 that would do it.

### 1.5 Reference implementation (core of the throwaway script)

```ts
const HARD = {
  H1: /\basync\b|\bawait\b|\bnew Promise\b|\.then\(|\bPromise\.(?:all|allSettled|race|any|resolve|reject)\b/,
  H2: /(?<![\w.$])fetch\(|\bXMLHttpRequest\b|\bnew (?:WebSocket|EventSource)\b|\bsendBeacon\(/,
  H3: /\b(?:setTimeout|setInterval|setImmediate|requestIdleCallback)\(/,
  H5: /\b(?:localStorage|sessionStorage|AsyncStorage|indexedDB)\b/,
};
const WEAK = {
  W4: /\btry\s*\{|\.catch\(|\bcatch\s*(?:\(|\{)/,
  W6: /\bJSON\.parse\(/,
  W7: /\bprocess\.env\b|\bimport\.meta\.env\b|\bEXPO_PUBLIC_\w+/,
};
// H8 and H9 test the module specifier of each import line instead.
const blank = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')) // block comments, keep line count
   .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')                       // line comments
   .replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
const classify = (path, src) =>
  isExempt(path, src) ? 'exempt'
  : importsEffect(src) ? 'effect'
  : hits(blank(src), { ...HARD, ...WEAK }) || importHits(src) ? 'needs-effect'
  : 'plain';
```

### 1.6 Baseline by that rule

Counts are non-test source files; "lines" are physical lines. Exempt files that carry a signal are shown apart; Tier B is the share of Effect files with a hard signal.

| Package | Files | Lines | Effect files (lines) | Failing files (lines) | Plain files (lines) | Exempt with signals | Tier B: Effect files with hard signals | Coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| packages/protocol | 14 | 700 | 12 (684) | 0 (0) | 2 (16) | 0 (0) | 0 (0) | 100% |
| packages/ui-tokens | 1 | 206 | 0 (0) | 0 (0) | 1 (206) | 0 (0) | 0 (0) | n/a |
| packages/chat-core | 16 | 1571 | 0 (0) | 0 (0) | 16 (1571) | 0 (0) | 0 (0) | n/a |
| packages/agent-drivers | 4 | 704 | 1 (574) | 0 (0) | 3 (130) | 0 (0) | 1 (574) | 100% |
| apps/runner | 5 | 1085 | 3 (635) | 2 (450) | 0 (0) | 0 (0) | 3 (635) | 59% |
| packages/runner-tunnel | 8 | 2338 | 3 (1495) | 4 (801) | 1 (42) | 0 (0) | 2 (1262) | 65% |
| packages/xmpp-core | 9 | 2860 | 0 (0) | 1 (1142) | 8 (1718) | 0 (0) | 0 (0) | 0% |
| packages/devtools | 38 | 9043 | 7 (1966) | 21 (6160) | 10 (917) | 0 (0) | 5 (1664) | 24% |
| scripts | 2 | 333 | 0 (0) | 1 (199) | 1 (134) | 0 (0) | 0 (0) | 0% |
| apps/server | 202 | 61533 | 135 (51091) | 37 (7384) | 30 (3058) | 0 (0) | 91 (41369) | 87% |
| apps/web | 193 | 47359 | 6 (3325) | 86 (30749) | 98 (8901) | 3 (4384) | 3 (3075) | 10% |
| apps/mobile | 329 | 61077 | 29 (8436) | 119 (35258) | 164 (14696) | 17 (2687) | 25 (7958) | 19% |
| apps/site | 8 | 1429 | 0 (0) | 0 (0) | 4 (341) | 4 (1088) | 0 (0) | n/a |
| **Total** | 829 | 190238 | 196 (68206) | 271 (82143) | 338 (31730) | 24 (8159) | 130 (56537) | 45.4% |

Reading the table: **chat-core, ui-tokens and protocol need nothing**; **xmpp-core is one file**; the server is already 87% by this measure; web (10%) and mobile (19%) are where the work is, 66,000 of the 82,143 failing lines.

## 2. The inventory

The table above is the per-package count. The line-by-line list (every failing file, its first failing line, what fails, and the task that fixes it) is **Appendix A**: 271 files, grouped by package and folder. Smallest package first, with the points worth knowing:

- **`packages/protocol`, `ui-tokens`, `chat-core`, `agent-drivers`:** nothing fails. `chat-core` is pure by design (its only import from `xmpp-core` is types, `packages/chat-core/src/mentions.ts`). `agent-drivers` has one Effect file and a test fake that is out of scope (`fake-opencode-server.ts:1` imports `node:http`). Protocol has two Tier B hits: `packages/protocol/src/common.ts:133` and `payload.ts:81,92` (a `try` and a `JSON.parse` inside Schema code).
- **`apps/runner` (2 files, 450 lines):** `cli.ts` (async at `:84`, env at `:75`, try at `:100`) and `connect.ts` (async at `:54`, try at `:31`).
- **`packages/runner-tunnel` (4 files, 801 lines):** `mux.ts:12` (its own `delay` helper, `net` at `:1`, `ws` types at `:2`, try/catch from `:100`), `http-agent.ts:16`, `demo.ts:19` (a script, `package.json:12`), `keys.ts:45` (pure signature check).
- **`packages/xmpp-core` (1 file, 1,142 lines):** `client.ts`. The other 8 files, 1,718 lines, are clean. The file is one closure with 18 mutable `let`s (`:209-250`), three maps of pending promises (`:248-250`) and 8 timer sites (`:311`, `:521`, `:539`, `:861`, `:905`, `:1028`, `:1059`, `:1102`).
- **`scripts` (1 file, 199 lines):** `screenshots.ts:44`.
- **`packages/devtools` (21 files, 6,160 lines):** the lead CLI and autopilot (`lead/autopilot.ts:123`), the gate (`gate/cli.ts`, `plan.ts`, `slots.ts`), `smoke.ts`, `xmpp-e2e.ts` (458 lines, 67 async hits), the Ink watcher `lead/watch-app.tsx:713`, and `lead/policy.ts` (1,112 lines; a `node:fs` import at `:1`, an env read at `:1058`).
- **`apps/server` (37 files, 7,384 lines):**
  - the AI gateway cluster: 12 files, 3,086 lines (`agents/gateway.ts:291`, `agents/gateway/*.ts`, `agents/memory/compactor.ts:42`);
  - the sandbox worker and fetch guard (`sandbox/tool-worker.ts:57`, `host-fetch.ts:64`);
  - push (`push/component.ts:62`, `sender.ts:43`);
  - the entry point `index.ts` (`:76-77` top-level `await runMigrations`, `:507-541` hand-written shutdown);
  - small edges: `search/routes.ts:305`, `drafts/hub.ts:108`, `voice/engine.ts:77`, `git/proxy.ts:142`, `connections/probe.ts:62`, `auth/auth.ts:79`, `db/client.ts:23`, `db/migrate-cli.ts:15`, `gifs/routes.ts:37`, `version.ts:4`;
  - 8 pure files that only need a marker (the three `crypto.ts` files, `actions/canonical.ts`, `groups/events.ts`, `web-tools/feed.ts`, `web-tools/html.ts`, `sandbox/ip-guard.ts`);
  - one spike script, `ai/integration.ts` (220 lines, 22 `console.log`, not referenced by any `package.json` script; decision D4).
- **`apps/web` (86 files, 30,749 lines):**
  - the stores: `store/realStore.ts` (4,809 lines, 156 async hits, one closure from `:768`) and `store/store.ts` (1,863 lines; the mock store plus the `ChatStoreState` type that both stores use);
  - 33 components in `components/` plus `ais/`, `tools/`, `machines/`, `approvals/`, `auth/` (about 16,600 lines);
  - 18 routes (4,806 lines);
  - 20 `lib/` files (2,523 lines), among them `voice.ts` (MediaRecorder), `push.ts` (service worker) and nine small hooks;
  - `auth/AuthProvider.tsx` and `App.tsx`.
  - Already Effect: `lib/api.ts` (2,691 lines, but with 95 async hits and 6 raw `fetch` sites at `:253`, `:1626`, `:1903`, `:2135`, `:2589`, `:2659`, so it is Tier B), `lib/drafts.ts`, `lib/tools.ts`, `store/atomStore.ts`.
- **`apps/mobile` (119 files, 35,258 lines):**
  - the stores: `store/real-store.ts` (4,357 lines, 161 async hits, one closure from `:365`) and `store/chat-store.ts` (1,595 lines, the mock store);
  - `app/` screens (about 10,600 lines, `app/chat/[id].tsx` alone 1,095);
  - `components/chat` (29 files, 8,468 lines), `components/ais`, `stickers`, `contacts`, and friends;
  - `lib/` native wrappers (`attachment-native.ts`, `voice-native.ts`, 856 lines) and `auth/` (6 files, 583 lines);
  - the 25 `lib/*-api.ts` clients are already Effect (Tier B).
- **`apps/site` (4 files, 1,088 lines with signals):** a three.js marketing page (`scene.ts`, `instruments.ts`, `controls.ts`, `main.ts`). Exempt under D2.

## 3. Designs for the big pieces

All designs follow the decisions in section 1.1: Effect inside, `Context.Service` plus `Layer` for ports (the server already uses `Context.Service`, `apps/server/src/config.ts:454`), tagged errors, `Scope` for lifetimes, tests inject fakes as test layers. No new design asks for a new dependency except D5.

### 3.1 `xmpp-core`

**Today.** `createCore` (`packages/xmpp-core/src/client.ts:209`) is one closure. It keeps 18 mutable `let`s (`:209-250`), listener sets and three maps of pending promises (`:245-250`), eight `setTimeout` sites, and wires the `@xmpp/client` event emitter by hand (`:617-690`). The public surface is the `XmppCore` interface (`types.ts:246`): Promise methods plus `on(event, cb)` returning an unsubscribe function (`types.ts:298`). Reconnect has two hand-made schedules (`RECONNECT_BACKOFF_MS` `:90`, `WATCHDOG_SCHEDULE_MS` `:76`), and stale-client events are blocked with `current !== xmpp` guards (`:322`).

**Target.**

- **Connection as a Scope.** `Effect.acquireRelease` around `createClient(...)` and `start()`/`stop()` (the factory seam `CoreDependencies.createClient`, `:101-105`, stays, as a Layer). A stuck client (`restartStuckClient`, `:320`) is "close the scope, open a new one"; the stale-event guards go away because closing the scope interrupts that client's fibers.
- **Events as Streams.** One `PubSub` per event kind (the ten names in `EventPayload`, `:107`), exposed as `Stream`. `on(event, cb)` stays as a thin wrapper that forks a consumer and returns an interrupt function, so web, mobile and the gateway keep their code until they move.
- **Timers as fibers.** Keepalive idle/reply (`:521`, `:539`), watchdog (`:311`) and connect timeout (`:861`) become `Effect.sleep` fibers with `timeoutOrElse` (guide `:165`); the backoff list becomes a `Schedule`.
- **Request/response as `Deferred`.** `pendingJoins`, `pendingQueries` and `pendingIqs` become a keyed `Ref<Map<string, Deferred>>`; each request is `Deferred.await` plus `timeoutOrElse`, cleaned up with `Effect.ensuring`. This replaces the `clearTimeout` and `delete` scattered at `:478`, `:739-743`, `:779`, `:815`, `:914`, `:1038`, `:1080`, `:1116`.
- **Typed errors.** Today failures are `new Error(text)` at `:479`, `:740`, `:781`, `:817`, `:840`, `:862`, `:885`, `:907`, `:1011`, `:1030`, `:1061`, `:1104`. Each becomes a `Data.TaggedError` (`NotOnline`, `Disconnected`, `ConnectTimeout`, `JoinRejected`, `JoinTimeout`, `IqFailed`, `HistoryFailed`, `UploadSlotInvalid`), and the fatal-token test (`isFatalTokenError`, `:177`) becomes an `AuthFailed` error. Texts that tests assert stay byte-identical in the Promise facade.
- **Clock and ids.** `now` and `generateId` (`:101-105`) become `Clock` and a small service, so tests drive time with `TestClock`.
- **Public API.** `XmppCoreEffect` (new, exported in X7) and the unchanged Promise facade `createXmppCore` (`index.ts:36`). Existing tests run against the facade and must pass unchanged: `core.test.ts` (1,275 lines), `connection-resilience.test.ts` (576), `events.test.ts`, `presence.test.ts`, `stream-management.test.ts`, `mam.test.ts`. The `integration-*.test.ts` files need ejabberd and are run by hand.

**Stays plain.** `stanza.ts`, `types.ts`, `jid.ts`, `text.ts`, `namespaces.ts`, `mam.ts`, `stream-management.ts`: pure builders and parsers with no signal.

**Consumers.** Web `apps/web/src/store/realStore.ts:773`, mobile `apps/mobile/src/store/real-store.ts:369`, server `apps/server/src/agents/gateway.ts:62` and `agents/gateway/sessions.ts`, `contracts.ts:2`. (`packages/devtools/src/xmpp-e2e.ts:14` imports `@xmpp/client` directly, not `xmpp-core`.) They move in phases 2 to 4; the facade is deleted in X8 when none is left.

**Risk and what to test.** Reconnect, background/resume, history after reconnect, group join, upload slot, push toggle. Web: sign in, load chats, send and receive a DM and a group message, drop the network in devtools, watch it reconnect, check history. Emulator: the same, plus send the app to the background and resume (`real-store.ts:3149`, `reconnect`), attach a file, join a group. Server: an AI answers in a DM and in a group (`agents/gateway.test.ts`, 7,242 lines).

### 3.2 `chat-core`

Nothing to convert. All 16 files are pure logic with zero signals (edits, mentions, reactions, folders, links, markdown, format), which is exactly the "may stay plain" class. The one addition is `packages/chat-core/src/url.ts` (task R3): a pure `parseUrl(text): URL | undefined` and `safeDecode(text): string`, with a marker, so the seven `try { new URL() }` sites stop being false positives. Callers use these functions inside Effects without wrapping. Risk: none beyond the helper's own unit tests.

### 3.3 The web data layer

**Today.** `apps/web/src/lib/api.ts` has 140 exports. One private `request()` (`:238`) does `await fetch` (`:253`) with a mock branch (`:247`), maps network failure to `ApiError(0, 'network_error', ...)` (`:258`), reads JSON, and decodes with an Effect Schema (`decodeResponse`, `:31`). Five more raw `fetch` sites serve special requests (search, sticker, GIF, avatar and background calls at `:1626`, `:1903`, `:2135`, `:2589`, `:2659`; the function names are at `:1613`, `:2122`, `:2579`); `lib/tools.ts:117` and `components/Composer.tsx:454` have their own. 75 non-test files import `@/lib/api`. Components wrap each call in `busy` state, `try`/`catch` and `finally`.

**Target: lift first, sink later.** This order keeps every existing component test unchanged, because those tests fake `fetch` (see the comment on `isMockApiEnabled` in `apps/web/src/mock/gate.ts`).

1. **Lift (Phases 1 and 3).** F1 adds a web runtime (`ManagedRuntime`) and a `FetchHttpClient` layer (`effect/http` exists in `effect@4.0.2`: `dist/http/HttpClient.d.ts`, `FetchHttpClient.d.ts`; it is already used on the server for `HttpServer`). F2 adds `useAction`/`useQuery`. A component keeps calling the same API function and wraps it: `useAction(() => Effect.tryPromise(() => createGroupInviteLink(id, input)))`. This is the "lift with `Effect.promise`" move of `docs/EFFECT_GUIDE.md:101-124`. No test changes.
2. **Sink (optional Phase 6, Appendix B).** `api.ts` functions return `Effect` natively, error `ApiError` becomes a tagged error that keeps `status`, `code`, `message`, the Promise exports go once nobody calls them.

**Stays plain.** Format helpers, pure hooks (`useMediaQuery.ts`), presentational components. **Mock mode** (`mock/api.ts`, 4,298 lines) stays under the exempt rule.

**Risk and what to test (web, on real chats with Julio's OK per the live-check rule).** Double-submit guards (the `busy` flag becomes the `AsyncResult` state), unmount cancellation, identical error sentences, Retry buttons. Flows: sign in, create a group, create and use an invite link, upload a sticker pack, record a voice message, enable push.

### 3.4 The mobile data layer

**Today.** The 25 `lib/*-api.ts` files are Effect Schema plus `Effect.runPromise` at the edge (recipe `docs/EFFECT_GUIDE.md:235-243`); each takes `fetchImpl: typeof fetch = fetch` (`apps/mobile/src/lib/pins-api.ts:131,165`). 13 `components/*/use-*-api.ts` hooks read `process.env.EXPO_PUBLIC_ZILAR_MOCK` and pick the real or mock client (`components/ais/use-tools-api.ts:44`, `components/chat/use-invites-api.ts:22`, `store/chat-store-provider.tsx:47`). Native wrappers are seams with fakes in tests (`lib/voice-native.ts:95`, `real-store.ts:155` `AppStateLike`).

**Target.** Same two moves as web. F3 builds the mobile runtime and **checks `FetchHttpClient` on Hermes** with `expo export` plus `pnpm phone:smoke` (unverified: I did not run it; if it fails, mobile keeps `Effect.tryPromise` over the injected `fetchImpl`, decision D6). The mock switch reads the env once, in `mock/gate.ts` (task R5), because Expo inlines only a literal `process.env.EXPO_PUBLIC_*` (`apps/mobile/src/lib/auth.ts:19-22`). Native seams (`voice-native`, `attachment-native`, `AppState`, SecureStore) become `Context.Service` ports with a live layer and a fake layer.

**Stays plain.** `lib/emoji-data.ts` stays only if its async load goes (it has 4 async hits, so it is converted in MU2); pure helpers (`lib/format.ts`, `lib/colors.ts`), presentational components.

**Risk and what to test (emulator).** A Hermes crash (`WeakRef` in `Atom`, `docs/audit/effect-atom-react-plan.md` section 6) and bundle size are checked in F3. Flows: sign in with the email OTP, chat list, send text, record and play a voice message, pick and upload an attachment, edit a sticker pack, enable push, open an invite link.

### 3.5 The two stores (web and mobile)

**Today.** `createRealChatStore` is one closure: web `apps/web/src/store/realStore.ts:768-4808`, mobile `apps/mobile/src/store/real-store.ts:365-4357`. Cancellation is a manual `generation` counter (web `:793`, mobile `:460`), teardown is a hand-written `stop()` of about 50 lines (web `:4649-4694`, mobile `:4307-4356`), timers are scattered (web `setTimeout`/`setInterval` at `:878`, `:885`, `:1734`, `:2169`, `:2212`, `:2483`, `:2694`, `:2808`, `:3145`; mobile `:1895`, `:1958`, `:2348`, `:2556`, `:2676`, `:3005`, `:3012`). The state container is already a single atom (`apps/web/src/store/atomStore.ts:1-74`, T-0526; mobile T-0531). The slice-by-slice atom split planned in `docs/audit/effect-atom-react-plan.md:376-403` (W2 to W10, M2 to M6) was never run and this plan replaces it: the rule only asks that shared state live in atoms, and it does.

**Target.**

- **Lifetime.** The store's lifetime is one `Scope` opened by `start()` and closed by `stop()` (provider: `apps/web/src/store/ChatStoreProvider.tsx:26-32`). The `generation` counters, the `unsubscribers` array (`realStore.ts:788`) and the `typingTimers` record (`:789`) disappear: interruption replaces them.
- **Concerns as Effect modules.** One file per concern under `store/effects/` (lifecycle, polling, history, send A, send B, groups and topics, events, pins and media), each taking a `Ports` service (api, storage, voice, attachments, drafts, clock, XMPP factory; today `RealStoreDeps`, `realStore.ts:768-775`).
- **Loops** use `Effect.repeat(Schedule.spaced)` plus `catchDefect` (guide `:168-169`), send timeouts use `timeoutOrElse`, typing timers are per-chat fibers.
- **The compat `StoreApi`** (`getState`, `setState`, `subscribe`) stays, so the 42 web and 37 mobile readers and the store tests do not move (`docs/audit/effect-atom-react-plan.md:312-340`).
- **Stays plain.** The edit, reaction and id-alias bookkeeping (web `realStore.ts:983-1450`, about 470 lines) and the pure mappers (`toUiMessage` `:2325`, `summaryFor` `:619`). After the split, `realStore.ts` holds wiring and these helpers and should be `plain`; the new effect modules carry the Effect lines.
- **Order inside a store is serial** (one file, one writer). The pieces and their anchors are the rows WS1 to WS11 and MS1 to MS10; the function starts were checked with `rg`, but the exact end lines of each range are unverified and the spec for each task must re-read them.

**Hazards that must keep passing** (from `docs/audit/effect-atom-react-plan.md` section 6): the single-update draft tests (`apps/web/src/store/realStore.test.tsx:2690`, `apps/mobile/src/store/real-store.test.ts:894`), synchronous read-after-set in `openAtMessage` and `react`, stable empty selectors (`selector-stability.test.ts:9`), and Effect timers that do not `unref`, so `stop()` must interrupt every fiber (`docs/EFFECT_GUIDE.md:170`).

**Risk and what to test.** This is the highest-risk piece: connect and reconnect, history, sending text, attachments, voice, stickers and forwards, retries after failure, typing, edits and deletes. Web: the flows of 3.1 plus retry a failed send and open a long history. Emulator: the same, plus resume after background.

### 3.6 The UI action pattern (web and mobile)

Applies to 82 web files and 93 mobile files in tasks WU1 to WU26 and MU1 to MU25.

```tsx
// before: three pieces of state and a try/catch in the component
const [busy, setBusy] = useState(false);
const [error, setError] = useState<string>();
const createLink = async (input: LinkInput) => {
  setBusy(true); setError(undefined);
  try { await createGroupInviteLink(groupId, input); } catch { setError('Could not create the link.'); }
  finally { setBusy(false); }
};

// after: no async code in the component
const [state, createLink] = useAction((input: LinkInput) =>
  Effect.tryPromise({ try: () => createGroupInviteLink(groupId, input), catch: () => new LinkCreateFailed() }));
// state is an AsyncResult: waiting, success or failure; the sentence comes from a fixed map of errors
```

Rules: no `async`, `await`, `.then`, `try` or timer in a component or screen; `useState` for open/closed and input text stays; subscriptions and polling use `useQuery` (interrupted on unmount by the registry scope, `docs/audit/effect-atom-react-plan.md:92-111`); user-facing errors are fixed sentences (`AGENTS.md:57`). A test that fakes `fetch` or a store action keeps working. Mobile screens have no unit tests next to them in most cases (the rows say "none beside the file"), so those tasks are proven with `pnpm phone:smoke <branch>` and a look at every screenshot (`docs/LEAD_LOOP.md:57`).

### 3.7 Server leftovers

- **AI gateway (S1 to S4).** Sessions become a `FiberMap`/`Scope` per AI session; the per-session pump (`agents/gateway.ts:291`) becomes a `Queue` plus one worker fiber; the `busy` flag becomes a `Semaphore`; budget, memory and tool execution are `Effect.gen` pipelines. The 12 files already have clean seams (T-0523, T-0529, T-0534, T-0540 extracted them). S3 depends on `XmppCoreEffect` (X7). Tests: `agents/gateway.test.ts` (7,242 lines), `rounds.test.ts`, `context.test.ts`, `reply.test.ts`. Risk: AI replies in live chats (Julio flag).
- **Sandbox (S5).** `sandbox/tool-worker.ts` runs inside a worker thread, so it needs its own tiny runtime. `work/NOW.md` records a flaky QuickJS line, `Aborted(JS_FreeRuntime)`, in about one test run in three; do not change the worker lifecycle without keeping that test stable.
- **Push (S6).** `push/component.ts:62-77` chains promises per node in a `Map`; use a keyed `Semaphore` per node, started with `Effect.forkIn` on the component scope.
- **Entry point (S12, S13).** `index.ts` runs top-level `await runMigrations(db)` (`:76-77`), builds each component by hand and stops them in a fixed list (`:507-541`). Target: `startServer` as one `Effect.gen` over Layers, shutdown by closing the Scope, then `NodeRuntime.runMain`. Risk: deploy. The 10-09 incident in `work/NOW.md` (a missing production dependency crash-looped the live service) is the reason S13 requires a rehearsal on a scratch Postgres, and the CI smoke start from T-0743 must stay green.
- **Small edges (S7 to S10).** Each is one `Effect.gen` or `Effect.tryPromise`. `auth/auth.ts:79` is a better-auth callback (`sendVerificationOTP`); the `Effect.runPromise` stays at that callback because the library wants a Promise. That makes it a Tier B edge by design.
- **Markers (R2).** Eight pure files get `// effect-plain: ...`.

### 3.8 Runner, tunnel, devtools

- **`runner-tunnel/src/mux.ts` (H1).** It bridges `node:net` sockets and a `ws` WebSocket with its own `delay` helper (`:12`). `effect/socket` exists in `effect@4.0.2` (`dist/socket/Socket.d.ts`); whether it covers backpressure like the current 1 MiB buffer rule (`mux.ts:38`) is unverified, and H1 must start with a short spike. The typed `TunnelClosedError` (`:15`) already is a tagged-error shape.
- **`apps/runner` (H3).** `cli.ts` and `connect.ts` move to `Effect`; argument parsing stays as is (`docs/audit/effect-everywhere-plan.md:361-363` says not to replace it). May need `@effect/platform-node` for processes (decision D5).
- **devtools (H4 to H13).** The gate and the lead loop run every task. Rules: convert the gate first, behind the same CLI flags; each merge in H5 to H9 is followed by a smoke of `lead status` and the autopilot before the next; the lead keeps running from a pinned checkout while an H task is in flight. This part is skipped entirely if D7 says out of scope.

### 3.9 Flow checklist

| Flow | Web | Emulator | Tasks that can break it |
| --- | --- | --- | --- |
| Sign in (OTP) | yes | yes | S10, WU4, MU1 |
| Chat list and open a chat | yes | yes | WS2, WS4, MS2, MS4, X2 |
| Send text, attachment, voice, sticker, forward | yes | yes | WS5, WS6, MS5, MS6, WU3, WU18, MU16, MU18 |
| Receive a message, typing, read ticks | yes | yes | X3, WS8, MS8 |
| Drop network, reconnect, resume from background | yes | yes | X2, X6, WS2, MS2 |
| Groups, topics, channels, roles | yes | yes | WS7, MS7, WU15 to WU17, MU9 |
| AI replies | yes | yes | S3, S4 |
| Push enable and delivery | yes | yes | S6, WU3, WU9 |
| Invite link and join | yes | yes | WU5, MU7, MU20 |
| Server start, deploy | no | no | S12, S13 |

## 4. The ordered task list

**Sizing rules** (`docs/audit/effect-atom-react-plan.md:365-367`): about 400 changed lines or less per task and at most 0.5 day, one folder where possible. A task that touches several folders only does so for trivial edits (R2, R3, R4, R5) or for a handful of small files that belong together. Sizes here: 0.25 day for up to about 600 lines of files, 0.5 day above; the store and `xmpp-core` pieces are 0.5 day each because they extract and convert in one step. **Parallelism:** `CLAUDE.md` allows 8 workers and 3 mobile at once (`docs/LEAD_LOOP.md:14` still says 4; unverified which the lead wants now), one worker per file. Same-file chains are serial: X1 to X7, WS1 to WS11, MS1 to MS10, H4 to H9, S1 to S4.

**How to read the rows.** "Lines" is the size of the files in the task (or of the quoted ranges). "Tests" are the existing tests that must pass unchanged; mobile screens usually have none, so the check is `pnpm phone:smoke`. "Depends on" lists task ids. Tags: `web`, `mobile`, `server`, `shared` (used by several apps), `tooling`. "Julio" names why the lead should show him the result or ask first.

**Test suites named in the rows** (all existing, all must pass unchanged):

- (a) xmpp-core: `core.test.ts` (1,275 lines), `connection-resilience.test.ts` (576), `events.test.ts`, `presence.test.ts`, `stream-management.test.ts`, `mam.test.ts`. The `integration-*.test.ts` files need ejabberd and are run by hand.
- (b) web store: `realStore.test.tsx` (4,133 lines), `realStore.forward.test.tsx`, `realStore.media.test.tsx`, `realStore.topics.test.tsx`, `reload.test.tsx`, `atomStore.test.ts`.
- (c) mobile store: `real-store.test.ts` (2,498 lines) and its 13 `real-store.*.test.ts` siblings, `integration.test.ts`, `selector-stability.test.ts`, `atomStore.test.ts`.
- (d) gateway: `apps/server/src/agents/gateway.test.ts` (7,242 lines), `rounds.test.ts`, `context.test.ts`, `reply.test.ts`.

#### Phase 0: rule, markers, ratchet

| ID | Task | Files | Lines | Tests (existing, must pass unchanged) | Depends on | Tag | Days | Julio |
| --- | --- | --- | ---: | --- | --- | --- | ---: | --- |
| R1 | Map implements the 100% rule (classifier, exempt list, Tier A/B counts) | devtools/effect-map/generate.ts, devtools/effect-map/generate.test.ts |  | effect-map tests (new) | T-0752 | tooling | 0.5 | - |
| R2 | effect-plain markers on pure server files | connections/crypto.ts, push/crypto.ts, setup/crypto.ts +5 more | 1022 | crypto, canonical, feed +2 | R1 | server | 0.25 | - |
| R3 | Pure URL helper in chat-core; web users stop wrapping new URL in try/catch | chat-core/src/url.ts, components/MarkdownText.tsx, routes/ChatShell.tsx | 123 | MarkdownText, ChatShell | R1 | web | 0.25 | - |
| R4 | Mobile: use the chat-core URL helper; JSON.parse in tool-actions to Schema; markers for native probe, dev screen, scan tool | lib/attachments.ts, lib/gifs.ts, lib/markdown.ts +7 more | 2212 | attachments, gifs, markdown +4 | R3 | mobile | 0.5 | - |
| R5 | Mobile: read EXPO_PUBLIC_ZILAR_MOCK once, in mock/gate.ts; the 13 use-*-api hooks and the store provider import it | mock/gate.ts, components/ais/use-ai-memory-api.ts, components/ais/use-ais-api.ts +12 more | 659 | gate | R1 | mobile | 0.5 | - |
| R6 | Gate ratchet: pnpm gate fails when the needs-effect file count rises above the committed baseline | devtools/gate/plan.ts, devtools/effect-map/baseline.json |  | gate tests (2 files) | R1 | tooling | 0.25 | Julio: the gate runs for every task |

R6 as built (T-0768) is per file, not a committed baseline count: the gate's `effect` step checks each changed counted source against the branch base (`git show <base>:<path>`, the map's rules); a file that is needs-effect on the branch and was absent or not needs-effect on the base fails the gate with its first hit, while a file already needs-effect on the base passes and stays tracked by the map.

#### Phase 1: foundations and xmpp-core

| ID | Task | Files | Lines | Tests (existing, must pass unchanged) | Depends on | Tag | Days | Julio |
| --- | --- | --- | ---: | --- | --- | --- | ---: | --- |
| F1 | Web Effect runtime: ManagedRuntime, FetchHttpClient layer, ApiError as a tagged error | lib/effect/runtime.ts, lib/effect/http.ts, lib/effect/errors.ts |  | new tests, written in the task | - | web | 0.5 | - |
| F2 | Web hooks useAction and useQuery on @effect/atom-react (AsyncResult, interrupt on unmount) | lib/effect/use-action.ts, lib/effect/use-query.ts |  | new tests, written in the task | F1 | web | 0.5 | - |
| F3 | Mobile Effect runtime and FetchHttpClient Hermes spike (expo export + phone smoke) | lib/effect/runtime.ts, lib/effect/http.ts |  | new tests, written in the task | F1 | mobile | 0.5 | Julio: bundle size grows (+2.8 MiB already accepted); decision D6 if FetchHttpClient fails on Hermes |
| F4 | Mobile hooks useAction and useQuery | lib/effect/use-action.ts, lib/effect/use-query.ts |  | new tests, written in the task | F3, F2 | mobile | 0.5 | - |
| X1 | Typed errors, library-client port as acquireRelease, one PubSub per event | client.ts:92-135,209-300 | 136 | xmpp-core suite (a) | F1 | shared | 0.5 | - |
| X2 | Connection state machine: status, backoff Schedule, watchdog and keepalive as fibers, connect and disconnect | client.ts:209-575,840-898 | 426 | xmpp-core suite (a) | X1 | shared | 0.5 | Julio: messaging and reconnect risk; test web and emulator |
| X3 | Stanza handlers feed the event PubSub; roster, occupants, presence, stream management | client.ts:600-840 | 241 | xmpp-core suite (a) | X2 | shared | 0.5 | - |
| X4 | IQ requests as Deferred plus timeout: joinRoom, loadHistory, upload slot, push toggle | client.ts:899-1130 | 232 | xmpp-core suite (a) | X3 | shared | 0.5 | - |
| X5 | Send operations: message, reactions, correction, retraction, typing, displayed | client.ts:930-1003 | 74 | xmpp-core suite (a) | X3 | shared | 0.5 | - |
| X6 | createXmppCore facade over the Effect core; old closure deleted; every existing test unchanged | client.ts,index.ts |  | xmpp-core suite (a) | X4, X5 | shared | 0.5 | Julio: messaging and reconnect risk; test web and emulator |
| X7 | Export XmppCoreEffect (service + Stream accessors) for stores and the server gateway | index.ts,types.ts |  | xmpp-core suite (a) | X6 | shared | 0.5 | - |

#### Phase 2: server and tooling packages

| ID | Task | Files | Lines | Tests (existing, must pass unchanged) | Depends on | Tag | Days | Julio |
| --- | --- | --- | ---: | --- | --- | --- | ---: | --- |
| S1 | Gateway: budget, memory, group-ingest, live + memory compactor | agents/gateway/budget.ts, agents/gateway/memory.ts, agents/gateway/group-ingest.ts +2 more | 798 | gateway suite (d) | - | server | 0.5 | - |
| S2 | Gateway: sessions, lifecycle, listener (room listener timers and pumps) | agents/gateway/sessions.ts, agents/gateway/lifecycle.ts, agents/gateway/listener.ts | 768 | gateway suite (d) | S1 | server | 0.5 | - |
| S3 | Gateway: DM turn, tool-exec, gateway.ts pump (consumes XmppCoreEffect) | agents/gateway/dm-turn.ts, agents/gateway/tool-exec.ts, agents/gateway.ts | 991 | gateway suite (d) | S2, X7 | server | 0.5 | Julio: AI replies in live chats |
| S4 | Gateway: group turn | agents/gateway/group-turn.ts | 529 | gateway suite (d) | S3 | server | 0.5 | - |
| S5 | Sandbox: tool worker thread and host fetch | sandbox/tool-worker.ts, sandbox/host-fetch.ts | 747 | host-fetch | - | server | 0.5 | - |
| S6 | Push: component host and sender | push/component.ts, push/sender.ts | 251 | component | - | server | 0.25 | Julio: push delivery is live |
| S7 | Small edges A: voice engine, gifs route, version | voice/engine.ts, gifs/routes.ts, version.ts | 304 | engine, routes | - | server | 0.25 | - |
| S8 | Small edges B: search runSearch, drafts hub timers | search/routes.ts, drafts/hub.ts | 671 | hub | - | server | 0.5 | - |
| S9 | Small edges C: git proxy, connection probe | git/proxy.ts, connections/probe.ts | 283 | proxy, probe | - | server | 0.25 | - |
| S10 | Auth and db client: better-auth OTP hook, session helper, db client, migrate CLI | auth/auth.ts, auth/session.ts, db/client.ts, db/migrate-cli.ts | 250 | auth | - | server | 0.25 | Julio: login risk |
| S11 | Spike script ai/integration.ts: delete or mark (decision D4) | ai/integration.ts | 220 | new tests, written in the task | - | server | 0.25 | Julio: decision D4 |
| S12 | index.ts part 1: startServer as one Effect program, components as Layers | index.ts | 550 | CI smoke start of the server image (T-0743); no unit test yet | S2, S6 | server | 0.5 | Julio: deploy risk |
| S13 | index.ts part 2: NodeRuntime.runMain, shutdown by closing the Scope, rehearsal on scratch Postgres | index.ts |  | CI smoke start of the server image (T-0743); rehearsal on scratch Postgres | S12 | server | 0.5 | Julio: deploy risk; follow the 10-09 deploy rehearsal |
| H1 | runner-tunnel mux over Effect Socket + Scope (ws lifecycle) | runner-tunnel/src/mux.ts | 428 | runner-tunnel mux, resilience, engine, runner, server tests | - | tooling | 0.5 | Julio: runner traffic (AI desks) |
| H2 | runner-tunnel: http-agent; markers for demo script and key check | runner-tunnel/src/http-agent.ts, runner-tunnel/src/demo.ts, runner-tunnel/src/keys.ts | 373 | runner-tunnel auth, engine, keys tests | H1 | tooling | 0.25 | - |
| H3 | apps/runner: cli and connect on Effect | apps/runner/src/cli.ts, apps/runner/src/connect.ts | 450 | apps/runner cli, connect, e2e tests | H2 | tooling | 0.5 | Julio: may add @effect/platform-node |
| H4 | devtools gate: cli, plan, slots | devtools/gate/cli.ts, devtools/gate/plan.ts, devtools/gate/slots.ts | 573 | gate tests (2 files) | R6 | tooling | 0.5 | Julio: the gate runs for every task |
| H5 | devtools lead: git, status, reply, fresh-session, start-prereview, launch, switch-model, merge | devtools/lead/git.ts, devtools/lead/status.ts, devtools/lead/reply.ts +5 more | 980 | lead launch, merge, reply, switch-model, start-prereview, fresh-session tests | H4 | tooling | 0.5 | Julio: the lead loop |
| H6 | devtools lead: doctor, sweeper, processes | devtools/lead/doctor.ts, devtools/lead/sweeper.ts, devtools/lead/processes.ts | 784 | lead doctor, sweeper, processes tests | H5 | tooling | 0.5 | Julio: the lead loop |
| H7 | devtools lead: autopilot | devtools/lead/autopilot.ts | 665 | lead autopilot test | H6 | tooling | 0.5 | Julio: the autopilot runs live |
| H8 | devtools lead: cli and watch-format | devtools/lead/cli.ts, devtools/lead/watch-format.ts | 635 | lead watch-format, policy tests | H7 | tooling | 0.5 | Julio: the lead loop |
| H9 | devtools lead: policy | devtools/lead/policy.ts | 1112 | lead policy test | H8 | tooling | 0.5 | Julio: the lead loop |
| H10 | devtools lead: watch-app (Ink UI timers) | devtools/lead/watch-app.tsx | 736 | lead watch test | H8 | tooling | 0.5 | - |
| H11 | devtools: smoke | devtools/smoke.ts | 217 | none beside the file (add one; screens: phone:smoke) | - | tooling | 0.25 | - |
| H12 | devtools: xmpp-e2e (uses @xmpp/client directly, not xmpp-core) | devtools/xmpp-e2e.ts | 458 | none beside the file (add one; screens: phone:smoke) | - | tooling | 0.5 | - |
| H13 | scripts/screenshots.ts | scripts/screenshots.ts | 199 | none beside the file (add one; screens: phone:smoke) | - | tooling | 0.25 | - |

#### Phase 3: web

| ID | Task | Files | Lines | Tests (existing, must pass unchanged) | Depends on | Tag | Days | Julio |
| --- | --- | --- | ---: | --- | --- | --- | ---: | --- |
| WU1 | lib hooks: delayed, search, people search, counts, polling, folders, owner, transcription | lib/useDelayed.ts, lib/useMessageSearch.ts, lib/usePeopleSearch.ts +6 more | 701 | useDelayed, usePendingApprovalCount, useApprovalPolling +2 | F2 | web | 0.5 | - |
| WU2 | lib helpers: clipboard, handles, handleGate, blockedJids, topicsUi, background-image, stickers, sticker-images | lib/clipboard.ts, lib/handles.ts, lib/handleGate.ts +5 more | 843 | handleGate, blockedJids, background-image +2 | F1 | web | 0.5 | - |
| WU3 | lib platform ports: attachments, voice (MediaRecorder), push (service worker) | lib/attachments.ts, lib/voice.ts, lib/push.ts | 979 | attachments, voice, push | F1 | web | 0.5 | Julio: voice and push flows |
| WU4 | auth: AuthProvider, AuthFlow, LoginPage, NamePage | auth/AuthProvider.tsx, components/auth/AuthFlow.tsx, routes/LoginPage.tsx, routes/NamePage.tsx | 461 | AuthProvider, AuthFlow, NamePage | F2 | web | 0.25 | Julio: login risk |
| WU5 | onboarding routes: HandlePage, InvitePage, SetupPage, JoinPage | routes/HandlePage.tsx, routes/InvitePage.tsx, routes/SetupPage.tsx, routes/JoinPage.tsx | 729 | HandlePage, SetupPage, JoinPage | WU4 | web | 0.5 | Julio: first-run setup and invite join |
| WU6 | routes: Approvals, Blocked, Requests, Folders | routes/ApprovalsPage.tsx, routes/BlockedPage.tsx, routes/RequestsPage.tsx, routes/FoldersPage.tsx | 822 | ApprovalsPage, BlockedPage, RequestsPage +1 | F2 | web | 0.5 | - |
| WU7 | routes: Ais, Connections, Integrations | routes/AisPage.tsx, routes/ConnectionsPage.tsx, routes/IntegrationsPage.tsx | 1207 | ConnectionsPage, IntegrationsPage | F2 | web | 0.5 | - |
| WU8 | machines: MachinesPage, AddMachineDialog, ApprovedMachineCard | routes/MachinesPage.tsx, components/machines/AddMachineDialog.tsx, components/machines/ApprovedMachineCard.tsx | 900 | MachinesPage, AddMachineDialog | F2 | web | 0.5 | - |
| WU9 | NotificationsPage, GroupHandleRoute | routes/NotificationsPage.tsx, routes/GroupHandleRoute.tsx | 742 | NotificationsPage, GroupHandleRoute | WU3 | web | 0.5 | Julio: push permission flow |
| WU10 | StickersPage | routes/StickersPage.tsx | 671 | StickersPage | WU2 | web | 0.5 | - |
| WU11 | ais: AiPanel | components/ais/AiPanel.tsx | 880 | AiPanel | F2 | web | 0.5 | - |
| WU12 | ais: AiActivity, AiMemorySection, NewAiDialog | components/ais/AiActivity.tsx, components/ais/AiMemorySection.tsx, components/ais/NewAiDialog.tsx | 877 | AiActivity, AiMemorySection, NewAiDialog | F2 | web | 0.5 | - |
| WU13 | tools: RoutinesSection, ToolDetailPanel, ToolsSection | components/tools/RoutinesSection.tsx, components/tools/ToolDetailPanel.tsx, components/tools/ToolsSection.tsx | 964 | none beside the file (add one; screens: phone:smoke) | F2 | web | 0.5 | - |
| WU14 | approvals: AlwaysAllowedList, ApprovalCard | components/approvals/AlwaysAllowedList.tsx, components/ApprovalCard.tsx | 522 | AlwaysAllowedList, ApprovalCard | F2 | web | 0.25 | - |
| WU15 | GroupPanel | components/GroupPanel.tsx | 988 | GroupPanel | F2 | web | 0.5 | - |
| WU16 | TopicPanel | components/TopicPanel.tsx | 1108 | TopicPanel | F2 | web | 0.5 | - |
| WU17 | ChannelPanel, ChannelComposerBar, InviteDialog, InviteLinksSection | components/ChannelPanel.tsx, components/ChannelComposerBar.tsx, components/InviteDialog.tsx, components/InviteLinksSection.tsx | 991 | InviteDialog, InviteLinksSection | F2 | web | 0.5 | - |
| WU18 | Composer | components/Composer.tsx | 1070 | Composer, Composer.voice | WU3 | web | 0.5 | Julio: sending is the core flow |
| WU19 | GifPanel, StickerPanel | components/GifPanel.tsx, components/StickerPanel.tsx | 932 | GifPanel, StickerPanel | WU2 | web | 0.5 | - |
| WU20 | PackEditor, TelegramImportDialog | components/PackEditor.tsx, components/TelegramImportDialog.tsx | 946 | PackEditor, TelegramImportDialog | WU2 | web | 0.5 | - |
| WU21 | VoiceMessage, AvatarUploader | components/VoiceMessage.tsx, components/AvatarUploader.tsx | 737 | VoiceMessage.player, VoiceMessage, AvatarUploader | WU3 | web | 0.5 | - |
| WU22 | dialogs: NewGroup, NewTopic, FolderEditor, AddContact | components/NewGroupDialog.tsx, components/NewTopicDialog.tsx, components/FolderEditorDialog.tsx, components/AddContactDialog.tsx | 1265 | NewGroupDialog, NewTopicDialog, FolderEditorDialog +1 | F2 | web | 0.5 | - |
| WU23 | ChatBackgroundDialog, ChatActionsMenu, ChatHeader | components/ChatBackgroundDialog.tsx, components/ChatActionsMenu.tsx, components/ChatHeader.tsx | 907 | ChatBackgroundDialog, ChatHeader.menu | F2 | web | 0.5 | - |
| WU24 | ContactProfileRow, ExplorePage, ProfileSettingsSection, VisibilitySection | components/ContactProfileRow.tsx, components/ExplorePage.tsx, components/ProfileSettingsSection.tsx, components/VisibilitySection.tsx | 1088 | ContactProfileRow, ExplorePage, ProfileSettingsSection +1 | F2 | web | 0.5 | - |
| WU25 | TaskStrip, ChatMediaPanel, PinnedBanner, PinsPanel, MessageSearchResults | components/TaskStrip.tsx, components/ChatMediaPanel.tsx, components/PinnedBanner.tsx +2 more | 1312 | TaskStrip, ChatMediaPanel | F2 | web | 0.5 | - |
| WU26 | ChatList, MessageBubble, App (fire-and-forget calls) | components/ChatList.tsx, components/MessageBubble.tsx, App.tsx | 1312 | ChatList, MessageBubble.forward, App | F2 | web | 0.5 | - |
| WS1 | Ports and runtime: the deps (api, storage, voice, attachments, drafts, clock, xmpp factory) become Layers | realStore.ts:768-808 | 41 | web store suite (b) | F1 | web | 0.5 | - |
| WS2 | Lifecycle: start, stop, signOut, boot, connectXmpp, retry; the generation counter becomes one Scope plus fibers | realStore.ts:3083-3226,4573-4694 | 266 | web store suite (b) | WS1, X7 | web | 0.5 | Julio: connect and reconnect risk |
| WS3 | Polling and the draft stream: chats poll, pins poll, draft SSE | realStore.ts:2138-2235,2435-2535 | 199 | web store suite (b) | WS2 | web | 0.5 | - |
| WS4 | History, previews, chat list refresh, openChat | realStore.ts:876-930,2819-3082,3818-3866 | 368 | web store suite (b) | WS2 | web | 0.5 | Julio: message history |
| WS5 | Send A: text and attachment (upload, send timeouts, retry) | realStore.ts:1728-1830,4165-4222,4295-4338,4491-4507 | 222 | web store suite (b) | WS2 | web | 0.5 | Julio: sending |
| WS6 | Send B: voice, sticker, forward | realStore.ts:1681-1712,3328-3520,4223-4294,4339-4490 | 449 | web store suite (b) | WS5 | web | 0.5 | Julio: sending |
| WS7 | Groups, topics, channels, members, createGroup, invite | realStore.ts:2057-2137,2239-2300,2780-2820,3542-3817,4508-4572 | 525 | web store suite (b) | WS2 | web | 0.5 | - |
| WS8 | Incoming events, typing timers, reactions, edits, deletes, chat prefs | realStore.ts:2533-2770,3239-3327,4007-4160,4695-4800 | 587 | web store suite (b) | WS2 | web | 0.5 | - |
| WS9 | Pins, media panel, openAtMessage, push pair | realStore.ts:3856-4006,4159-4164 | 157 | web store suite (b) | WS2 | web | 0.5 | - |
| WS10 | Sweep: the last async or try in realStore.ts; re-measure; delete dead helpers | realStore.ts |  | web store suite (b) | WS3-WS9 | web | 0.5 | - |
| WS11 | Move createChatStore (the mock store) and types out of store.ts; the mock file gets the marker | store.ts |  | web store suite (b) | WS10 | web | 0.5 | - |

#### Phase 4: mobile

| ID | Task | Files | Lines | Tests (existing, must pass unchanged) | Depends on | Tag | Days | Julio |
| --- | --- | --- | ---: | --- | --- | --- | ---: | --- |
| MU1 | auth: AuthFlow, NameForm, session storage, session store, session | auth/AuthFlow.tsx, auth/NameForm.tsx, auth/secure-session-storage.ts +3 more | 583 | AuthFlow, session-store | F4 | mobile | 0.25 | Julio: login risk |
| MU2 | lib basics: approval-state, auth, blocked-users, polyfills, session-token, stickers-storage, stickers, emoji-data | lib/approval-state.ts, lib/auth.ts, lib/blocked-users.ts +5 more | 1093 | approval-state, auth, blocked-users +3 | F3 | mobile | 0.5 | - |
| MU3 | lib voice and drafts: drafts, voice, voice-transcribe-flow, whistle-port | lib/drafts.ts, lib/voice.ts, lib/voice-transcribe-flow.ts, lib/whistle-port.ts | 996 | drafts, voice, voice-transcribe-flow +1 | F3 | mobile | 0.5 | Julio: voice flow |
| MU4 | lib native: attachment-native, voice-native (expo-file-system, expo-audio) | lib/attachment-native.ts, lib/voice-native.ts | 856 | attachment-native, voice-native | MU3 | mobile | 0.5 | - |
| MU5 | whistle module: download, transcribe | modules/zilar-whistle/src/download.ts, modules/zilar-whistle/src/transcribe.ts | 343 | none beside the file (add one; screens: phone:smoke) | F3 | mobile | 0.25 | - |
| MU6 | tabs: index, ais, profile, settings, _layout + app/_layout | app/(tabs)/_layout.tsx, app/(tabs)/ais.tsx, app/(tabs)/index.tsx +3 more | 1324 | none beside the file (add one; screens: phone:smoke) | F4 | mobile | 0.5 | - |
| MU7 | routes: explore, welcome/handle, at, u, join, invite | app/explore.tsx, app/welcome/handle.tsx, app/at/[handle].tsx +3 more | 1298 | none beside the file (add one; screens: phone:smoke) | F4 | mobile | 0.5 | Julio: invite join |
| MU8 | chat screen app/chat/[id].tsx | app/chat/[id].tsx | 1095 | none beside the file (add one; screens: phone:smoke) | F4 | mobile | 0.5 | - |
| MU9 | group and AI screens: group/[id], ais/[id], ais/new | app/group/[id].tsx, app/ais/[id].tsx, app/ais/new.tsx | 1431 | none beside the file (add one; screens: phone:smoke) | F4 | mobile | 0.5 | - |
| MU10 | settings A: approvals, blocked, requests, folders, folder/[id] | app/settings/approvals.tsx, app/settings/blocked.tsx, app/settings/requests.tsx +2 more | 1446 | none beside the file (add one; screens: phone:smoke) | F4 | mobile | 0.5 | - |
| MU11 | settings B: connections, integrations | app/settings/connections.tsx, app/settings/integrations.tsx | 1212 | none beside the file (add one; screens: phone:smoke) | F4 | mobile | 0.5 | - |
| MU12 | settings C: machines, profile | app/settings/machines.tsx, app/settings/profile.tsx | 1032 | none beside the file (add one; screens: phone:smoke) | F4 | mobile | 0.5 | - |
| MU13 | settings D: stickers, sticker-pack | app/settings/stickers.tsx, app/settings/sticker-pack.tsx | 1458 | none beside the file (add one; screens: phone:smoke) | MU2 | mobile | 0.5 | - |
| MU14 | components/ais A: ai-activity, ai-memory-section, routines-section | components/ais/ai-activity.tsx, components/ais/ai-memory-section.tsx, components/ais/routines-section.tsx | 954 | ai-activity, ai-memory-section, routines-section | F4 | mobile | 0.5 | - |
| MU15 | components/ais B: tool-detail-sheet, tools-section | components/ais/tool-detail-sheet.tsx, components/ais/tools-section.tsx | 956 | tool-detail-sheet, tools-section | F4 | mobile | 0.5 | - |
| MU16 | chat input A: composer, channel-composer-bar, new-chat-button | components/chat/composer.tsx, components/chat/channel-composer-bar.tsx, components/chat/new-chat-button.tsx | 1107 | new-chat-button | MU3 | mobile | 0.5 | Julio: sending |
| MU17 | chat input B: gif-panel, sticker-panel, channel-screen | components/chat/gif-panel.tsx, components/chat/sticker-panel.tsx, components/chat/channel-screen.tsx | 1110 | gif-panel, sticker-panel | F4 | mobile | 0.5 | - |
| MU18 | chat voice: voice-message, voice-player, voice-recorder | components/chat/voice-message.tsx, components/chat/voice-player.ts, components/chat/voice-recorder.tsx | 1438 | voice-message, voice-player, voice-recorder | MU4 | mobile | 0.5 | Julio: voice flow |
| MU19 | chat media: attachment-video, media-sheet | components/chat/attachment-video.tsx, components/chat/media-sheet.tsx | 754 | attachment-video, media-sheet | MU4 | mobile | 0.5 | - |
| MU20 | chat sheets: group-roles, invite-links, invite, visibility-fields, visibility-sheet | components/chat/group-roles-sheet.tsx, components/chat/invite-links-sheet.tsx, components/chat/invite-sheet.tsx +2 more | 1429 | group-roles-sheet, invite-links-sheet, invite-sheet +2 | F4 | mobile | 0.5 | - |
| MU21 | chat list: message-bubble, message-list, sticker-message | components/chat/message-bubble.tsx, components/chat/message-list.tsx, components/chat/sticker-message.tsx | 1197 | message-list, sticker-message | F4 | mobile | 0.5 | - |
| MU22 | chat search and small: message-search, message-search-list, search-jump, jump-scroll, skeleton, swipe-to-reply, approval-card | components/chat/message-search.ts, components/chat/message-search-list.tsx, components/chat/search-jump.ts +4 more | 1149 | message-search, search-jump, jump-scroll +1 | F4 | mobile | 0.5 | - |
| MU23 | stickers: pack-editor, sticker-native, telegram-import-sheet | components/stickers/pack-editor.ts, components/stickers/sticker-native.ts, components/stickers/telegram-import-sheet.tsx | 839 | pack-editor, sticker-native, telegram-import-sheet | MU2 | mobile | 0.5 | - |
| MU24 | contacts: add-contact, blocks, people-search, requests, use-people-search | components/contacts/add-contact.ts, components/contacts/blocks.ts, components/contacts/people-search.ts +2 more | 649 | blocks, people-search | F4 | mobile | 0.5 | - |
| MU25 | small components: avatar-native, card-save, save-connection, machine-change, approvals/rows | components/settings/avatar-native.ts, components/integrations/card-save.ts, components/connections/save-connection.ts +2 more | 686 | avatar-native, card-save, save-connection +2 | F4 | mobile | 0.5 | - |
| MS1 | Ports and runtime: the deps (api, appState, drafts, storage, clock, xmpp factory) become Layers | real-store.ts:365-445 | 81 | mobile store suite (c) | F3 | mobile | 0.5 | - |
| MS2 | Lifecycle: start, stop, boot, runBoot, reconnect, AppState; the generation counter becomes a Scope | real-store.ts:3019-3160,4289-4357 | 211 | mobile store suite (c) | MS1, X7 | mobile | 0.5 | Julio: connect, resume and reconnect risk |
| MS3 | Polling and the draft stream: pins, topics, draft SSE | real-store.ts:1874-1970,2368-2400 | 130 | mobile store suite (c) | MS2 | mobile | 0.5 | - |
| MS4 | History, previews, chat list refresh, openChat | real-store.ts:2738-3018,3215-3310 | 377 | mobile store suite (c) | MS2 | mobile | 0.5 | Julio: message history |
| MS5 | Send A: text, attachment upload, voice | real-store.ts:1337-1566,3310-3380,3594-3760 | 468 | mobile store suite (c) | MS2 | mobile | 0.5 | Julio: sending |
| MS6 | Send B: sticker, forward | real-store.ts:1566-1800,3380-3594 | 450 | mobile store suite (c) | MS5 | mobile | 0.5 | Julio: sending |
| MS7 | Groups, topics, channels, roles, members | real-store.ts:1804-2160,4047-4260 | 571 | mobile store suite (c) | MS2 | mobile | 0.5 | - |
| MS8 | Incoming events, edits, reactions, chat prefs, folders | real-store.ts:498-520,2398-2740,3761-3940,4259-4290 | 578 | mobile store suite (c) | MS2 | mobile | 0.5 | - |
| MS9 | Pins and media panel | real-store.ts:3940-4046 | 107 | mobile store suite (c) | MS2 | mobile | 0.5 | - |
| MS10 | Sweep real-store.ts; chat-store.ts (the mock store) gets the marker | real-store.ts,chat-store.ts |  | mobile store suite (c) | MS3-MS9 | mobile | 0.5 | - |

#### Phase 5: close out

| ID | Task | Files | Lines | Tests (existing, must pass unchanged) | Depends on | Tag | Days | Julio |
| --- | --- | --- | ---: | --- | --- | --- | ---: | --- |
| X8 | Delete the Promise facade after every consumer moved (web, mobile, server gateway) | index.ts |  | xmpp-core suite (a) | WS10, MS10, S3 | shared | 0.25 | - |
| Z1 | Turn the ratchet into a hard gate: needs-effect must be 0 (CI and pnpm gate) | devtools/gate/plan.ts, devtools/effect-map/baseline.json |  | gate tests | all convert tasks | tooling | 0.25 | Julio: gate policy |
| Z2 | Update EFFECT_GUIDE and ROADMAP_EFFECT: client patterns, ports, useAction, the 100% rule | docs/EFFECT_GUIDE.md, docs/ROADMAP_EFFECT.md |  | none (docs) | Z1 | docs | 0.25 | - |

**Critical paths** (after T-0752 merges): tooling chain R1, R6, H4 to H9, about 3.75 days; `xmpp-core` chain F1, X1 to X7, about 3.5 days; web store chain after X7, WS2 to WS11, about 5 days; mobile store chain after X7, MS2 to MS10, about 4.5 days. With 8 workers (3 on mobile) the 54.5 worker-days need roughly 10 to 13 working days; with review rounds I would plan for 2 to 3 weeks. Unverified: it is a sum over my own estimates. For scale, `work/NOW.md` (2026-10-09 07:00) records about 70 tasks merged overnight, many of them by Haiku 5.5.

**Slot plan.**

| Slots | Lane | Starts when |
| --- | --- | --- |
| 1 | Rule and tooling: R1, R2, R3, R6, then H11, H13 | T-0752 merged |
| 1 | `xmpp-core`: F1, then X1 to X7, X8 | at once |
| 2 | Server: S1 to S13 (S3 waits for X7, S12 for S2 and S6) | at once |
| 1 | Runner, tunnel, devtools: H1 to H3, then H4 to H10, H12 | at once; H4 after R6 |
| 2 to 3 | Web UI: F2, then WU1 to WU26 | F1 and F2 merged |
| 1 | Web store: WS1, then WS2 to WS11 | WS2 waits for X7 |
| 1 to 3 | Mobile: R4, R5, F3, F4, then MU1 to MU25 and MS1 to MS10 | web UI half done |

The lanes do not all run at once. The sum of the slots in use stays at 8 or less, and at most 3 of them are mobile: the server and tooling lanes are mostly done by the time the mobile lane widens. The lead picks the next task by the dependency column and the smallest unblocked file first.

## 5. Projection

Same measure as the old table (non-test files that import Effect, by lines) in the last column, and the new target metric before it. Assumptions, all unverified until the work is done: a converted file keeps its line count and ends as an Effect file; the two stores end half Effect and half plain (pure helpers stay in `realStore.ts` and `real-store.ts`); `client.ts` ends 85% Effect; new files (hooks, runtimes, markers) add a few hundred lines that I did not count. "Needs-effect lines" falls to 0, but marker and plain moves lower the "imports Effect" figure below 100%, which is correct by the definition.

| After | Tasks (cumulative) | Days (cumulative) | Failing files left | Effect lines | Failing lines | **Coverage (target metric)** | Imports-Effect share (old measure) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Today | 0 | 0 | 271 | 68206 | 82143 | 45.4% | 38.3% |
| Phase 0: rule, markers, ratchet | 6 | 2.25 | 237 | 68206 | 78127 | 46.6% | 38.3% |
| Phase 1: foundations and xmpp-core | 17 | 7.75 | 236 | 69177 | 76985 | 47.3% | 38.8% |
| Phase 2: server and tooling packages | 43 | 18.75 | 179 | 82852 | 63013 | 56.8% | 46.5% |
| Phase 3: web | 80 | 36.75 | 95 | 109210 | 32387 | 77.1% | 61.3% |
| Phase 4: mobile | 115 | 53.75 | 0 | 137824 | 0 | 100.0% | 77.4% |
| Phase 5: close out | 118 | 54.5 | 0 | 137824 | 0 | 100.0% | 77.4% |

Coverage is Effect lines / (Effect lines + failing lines). The jump in Phase 2 is the 13 server and 13 tooling tasks; Phase 3 is mostly 82 web UI files; Phase 4 closes mobile. Phase 5 is the hard gate (Z1), the guide update (Z2) and the removal of the Promise facade (X8).

## 6. Decisions for Julio

**Decided on 2026-10-09:**
- **Recommendations accepted:** D1 to D6, D8 and D9, as written in the table below.
- **D7 goes the other way:** `packages/devtools/**` is **exempt**, so tasks H4 to H12 are dropped. The R1 exempt list adds `packages/devtools/**`.
- **Still in scope:** `scripts/` (H13) and `apps/runner` with `packages/runner-tunnel` (H1 to H3).

| # | Question | My recommendation | If different |
| --- | --- | --- | --- |
| D1 | Is "100%" the Tier A rule (no failing file), with Promise edges (Tier B, 130 files) only tracked? | Yes. Tier B is how the server was converted on purpose (`docs/EFFECT_GUIDE.md:12-32`). | Appendix B (Phase 6) becomes mandatory: about 27 more tasks, 12 to 14 days (unverified). |
| D2 | Is `apps/site` (three.js marketing page, 4 files with signals, 1,088 lines) exempt? | Yes, it has no server logic and no state (`docs/audit/effect-everywhere-plan.md:147`, `:365`). | +2 tasks. |
| D3 | Are dev-only mock backends exempt (`mock/` folders, `-mock.ts`, the two mock stores)? | Yes. Web `store/store.ts` and mobile `store/chat-store.ts` are used as test fixtures by dozens of tests. | Delete mock mode instead: large test churn, not recommended. |
| D4 | Delete the spike script `apps/server/src/ai/integration.ts`, and keep or delete `runner-tunnel/src/demo.ts`? | Delete the first (nothing references it); mark the second (it has an npm script, `packages/runner-tunnel/package.json:12`). | Convert both: +1 task. |
| D5 | May `apps/runner` and `packages/devtools` depend on `@effect/platform-node` (already a server dependency)? | Yes; `AGENTS.md:43` forbids new dependencies unless a spec lists them. | Keep `node:child_process` behind `Effect.callback` wrappers (`Effect.async` does not exist in 4.0, `docs/EFFECT_GUIDE.md:164`). |
| D6 | Use Effect's `FetchHttpClient` on web and mobile? | Web yes. Mobile only if the F3 Hermes check passes. | Keep `Effect.tryPromise` over `fetch`; no plan change. |
| D7 | Is `packages/devtools` (the lead loop and gate, 21 files, 6,160 lines) in scope? | In, last, with a smoke after each merge. | Exempt `packages/devtools/**`: saves tasks H4 to H12 (9 tasks, 4.25 days); coverage would still read 100% by the rule. |
| D8 | May the lead run live checks (real chats, push) for the tasks flagged for login, messaging, push and deploy? | Yes, only with his OK each time (existing rule). | Emulator and local only. |
| D9 | Pace: 8 workers, at most 3 mobile, mobile after the web pattern is proven? | Yes. | A smaller cap lengthens the 2 to 3 weeks. |

## 7. Unverified, and risks

- **Not run:** nothing in this plan was built or tested; the gate runs only on the doc. `FetchHttpClient` and `Atom` on Hermes, `effect/socket` fitting `mux.ts`, and `ChildProcess` support for devtools are unverified (F3, H1, H5 start with a check).
- **Line ranges** in rows X1 to X5, WS1 to WS10 and MS1 to MS9 are starts that I confirmed with `rg`; the ends and the exact function lists must be re-read when each spec is written (lines move with every merge, as `CLAUDE.md` says).
- **Signal regexes** are line-based. I read the list of the 70 files with only one or two hits and opened about 20 of them; the false positives listed in section 1.4 come from that; a rare construct (for example `fetch(` inside a template-literal text) could still slip in. R1 should print the first matching line per file, as Appendix A does, so the lead can spot-check.
- **Projection** rests on the assumptions in section 5.
- **Doc conflicts:** `docs/LEAD_LOOP.md:14` (4 workers) versus `CLAUDE.md` (8 workers, 3 mobile); `AGENTS.md:41` (zod) is stale.
- **Counts differ from the task spec** (198 of 848 files, 36%) because my scope drops 20 fixture and test-helper files and main has moved since; the method is in section 1.4.
- **Risk summary:** messaging (xmpp-core, stores) and login are where a regression is user-visible; deploy is where an outage is. Those are the flagged tasks, and each has a flow in 3.9.

## Appendix A: every failing file

Generated from the same script as the baseline. "File:first line" is the first matching line; "What fails" lists up to four signals with their first lines; "(weak)" means only try/catch, JSON.parse or env reads. 271 files; the exempt and the clean files are not listed.

### apps/server: 37 files, 7384 lines


**actions** (1 files, 93 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/server/src/actions/canonical.ts:56` | 93 | try/catch @56 (weak) | R2 |

**agents** (12 files, 3086 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/server/src/agents/gateway.ts:291` | 312 | try/catch @291 (weak) | S3 |
| `apps/server/src/agents/gateway/budget.ts:40` | 172 | async/await/Promise @40; try/catch @49 | S1 |
| `apps/server/src/agents/gateway/dm-turn.ts:80` | 310 | async/await/Promise @80; try/catch @85 | S3 |
| `apps/server/src/agents/gateway/group-ingest.ts:148` | 186 | try/catch @148; async/await/Promise @158 | S1 |
| `apps/server/src/agents/gateway/group-turn.ts:121` | 529 | async/await/Promise @121; try/catch @128 | S4 |
| `apps/server/src/agents/gateway/lifecycle.ts:54` | 232 | async/await/Promise @54; try/catch @56; timer @198 | S2 |
| `apps/server/src/agents/gateway/listener.ts:109` | 249 | timer @109; async/await/Promise @124; try/catch @136 | S2 |
| `apps/server/src/agents/gateway/live.ts:45` | 229 | async/await/Promise @45; try/catch @73 | S1 |
| `apps/server/src/agents/gateway/memory.ts:48` | 145 | async/await/Promise @48; try/catch @59 | S1 |
| `apps/server/src/agents/gateway/sessions.ts:59` | 287 | timer @59; async/await/Promise @66; try/catch @69 | S2 |
| `apps/server/src/agents/gateway/tool-exec.ts:73` | 369 | async/await/Promise @73; try/catch @175 | S3 |
| `apps/server/src/agents/memory/compactor.ts:42` | 66 | async/await/Promise @42 | S1 |

**ai** (1 files, 220 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/server/src/ai/integration.ts:18` | 220 | env read @18; try/catch @35; JSON.parse @36; async/await/Promise @43 | S11 |

**auth** (2 files, 201 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/server/src/auth/auth.ts:79` | 188 | async/await/Promise @79; try/catch @80 | S10 |
| `apps/server/src/auth/session.ts:6` | 13 | async/await/Promise @6 | S10 |

**connections** (2 files, 207 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/server/src/connections/crypto.ts:69` | 105 | try/catch @69 (weak) | R2 |
| `apps/server/src/connections/probe.ts:62` | 102 | async/await/Promise @62; try/catch @66 | S9 |

**db** (2 files, 49 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/server/src/db/client.ts:23` | 26 | async/await/Promise @23 | S10 |
| `apps/server/src/db/migrate-cli.ts:7` | 23 | env read @7; try/catch @12; async/await/Promise @15 | S10 |

**drafts** (1 files, 149 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/server/src/drafts/hub.ts:108` | 149 | timer @108 | S8 |

**gifs** (1 files, 83 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/server/src/gifs/routes.ts:1` | 83 | node I/O import @1; async/await/Promise @37; timer @77 | S7 |

**git** (1 files, 181 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/server/src/git/proxy.ts:142` | 181 | async/await/Promise @142 | S9 |

**groups** (1 files, 56 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/server/src/groups/events.ts:22` | 56 | try/catch @22 (weak) | R2 |

**.** (2 files, 566 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/server/src/index.ts:58` | 550 | env read @58; try/catch @62; async/await/Promise @77; timer @519 | S12 |
| `apps/server/src/version.ts:1` | 16 | node I/O import @1; JSON.parse @4 | S7 |

**push** (3 files, 351 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/server/src/push/component.ts:62` | 180 | async/await/Promise @62; try/catch @76 | S6 |
| `apps/server/src/push/crypto.ts:65` | 100 | try/catch @65 (weak) | R2 |
| `apps/server/src/push/sender.ts:43` | 71 | async/await/Promise @43; try/catch @44 | S6 |

**sandbox** (3 files, 944 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/server/src/sandbox/host-fetch.ts:2` | 187 | node I/O import @2; try/catch @47; async/await/Promise @64; timer @175 | S5 |
| `apps/server/src/sandbox/ip-guard.ts:1` | 197 | node I/O import @1 | R2 |
| `apps/server/src/sandbox/tool-worker.ts:1` | 560 | node I/O import @1; try/catch @38; async/await/Promise @57; timer @58 | S5 |

**search** (1 files, 522 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/server/src/search/routes.ts:305` | 522 | async/await/Promise @305; try/catch @339 | S8 |

**setup** (1 files, 106 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/server/src/setup/crypto.ts:70` | 106 | try/catch @70 (weak) | R2 |

**voice** (1 files, 205 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/server/src/voice/engine.ts:1` | 205 | node I/O import @1; async/await/Promise @77; timer @83; try/catch @151 | S7 |

**web-tools** (2 files, 365 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/server/src/web-tools/feed.ts:137` | 157 | try/catch @137 (weak) | R2 |
| `apps/server/src/web-tools/html.ts:161` | 208 | try/catch @161 (weak) | R2 |

### packages/xmpp-core: 1 files, 1142 lines


**.** (1 files, 1142 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `packages/xmpp-core/src/client.ts:311` | 1142 | timer @311; async/await/Promise @320; try/catch @330 | X1 |

### packages/runner-tunnel: 4 files, 801 lines


**.** (4 files, 801 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `packages/runner-tunnel/src/demo.ts:1` | 198 | node I/O import @1; async/await/Promise @19; try/catch @46; JSON.parse @58 | H2 |
| `packages/runner-tunnel/src/http-agent.ts:1` | 76 | node I/O import @1; async/await/Promise @16 | H2 |
| `packages/runner-tunnel/src/keys.ts:45` | 99 | try/catch @45 (weak) | H2 |
| `packages/runner-tunnel/src/mux.ts:1` | 428 | node I/O import @1; async/await/Promise @12; timer @12; try/catch @100 | H1 |

### apps/runner: 2 files, 450 lines


**.** (2 files, 450 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/runner/src/cli.ts:75` | 296 | env read @75; async/await/Promise @84; try/catch @100 | H3 |
| `apps/runner/src/connect.ts:31` | 154 | try/catch @31; async/await/Promise @54 | H3 |

### packages/devtools: 21 files, 6160 lines


**gate** (3 files, 573 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `packages/devtools/src/gate/cli.ts:9` | 236 | node I/O import @9; env read @48; try/catch @57; JSON.parse @96 | H4 |
| `packages/devtools/src/gate/plan.ts:8` | 201 | node I/O import @8 | R6 |
| `packages/devtools/src/gate/slots.ts:7` | 136 | node I/O import @7; try/catch @24 | H4 |

**lead** (16 files, 4912 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `packages/devtools/src/lead/autopilot.ts:1` | 665 | node I/O import @1; try/catch @88; async/await/Promise @123; timer @643 | H7 |
| `packages/devtools/src/lead/cli.ts:1` | 386 | node I/O import @1; async/await/Promise @73; try/catch @381 | H8 |
| `packages/devtools/src/lead/doctor.ts:1` | 259 | node I/O import @1; try/catch @61; async/await/Promise @119 | H6 |
| `packages/devtools/src/lead/fresh-session.ts:43` | 66 | async/await/Promise @43 | H5 |
| `packages/devtools/src/lead/git.ts:1` | 44 | node I/O import @1 | H5 |
| `packages/devtools/src/lead/launch.ts:1` | 208 | node I/O import @1; try/catch @25; async/await/Promise @133 | H5 |
| `packages/devtools/src/lead/merge.ts:93` | 231 | async/await/Promise @93; try/catch @99 | H5 |
| `packages/devtools/src/lead/policy.ts:1` | 1112 | node I/O import @1; env read @1058 | H9 |
| `packages/devtools/src/lead/processes.ts:1` | 287 | node I/O import @1; async/await/Promise @178; timer @178; try/catch @182 | H6 |
| `packages/devtools/src/lead/reply.ts:1` | 79 | node I/O import @1; async/await/Promise @23; try/catch @35 | H5 |
| `packages/devtools/src/lead/start-prereview.ts:1` | 50 | node I/O import @1; async/await/Promise @23 | H5 |
| `packages/devtools/src/lead/status.ts:1` | 89 | node I/O import @1; try/catch @24; async/await/Promise @33 | H5 |
| `packages/devtools/src/lead/sweeper.ts:1` | 238 | node I/O import @1; async/await/Promise @191 | H6 |
| `packages/devtools/src/lead/switch-model.ts:1` | 213 | node I/O import @1; async/await/Promise @66 | H5 |
| `packages/devtools/src/lead/watch-app.tsx:7` | 736 | node I/O import @7; timer @713 | H10 |
| `packages/devtools/src/lead/watch-format.ts:130` | 249 | env read @130 (weak) | H8 |

**.** (2 files, 675 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `packages/devtools/src/smoke.ts:9` | 217 | node I/O import @9; env read @57; try/catch @77; async/await/Promise @99 | H11 |
| `packages/devtools/src/xmpp-e2e.ts:11` | 458 | node I/O import @11; async/await/Promise @39; timer @39; env read @49 | H12 |

### scripts: 1 files, 199 lines


**.** (1 files, 199 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `scripts/screenshots.ts:13` | 199 | node I/O import @13; async/await/Promise @44; try/catch @46; fetch/WebSocket @47 | H13 |

### apps/web: 86 files, 30749 lines


**.** (1 files, 27 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/web/src/App.tsx:14` | 27 | try/catch @14 (weak) | WU26 |

**auth** (1 files, 119 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/web/src/auth/AuthProvider.tsx:45` | 119 | async/await/Promise @45; try/catch @70 | WU4 |

**components** (33 files, 12938 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/web/src/components/AddContactDialog.tsx:45` | 142 | timer @45; async/await/Promise @46 | WU22 |
| `apps/web/src/components/ApprovalCard.tsx:66` | 254 | async/await/Promise @66; try/catch @71 | WU14 |
| `apps/web/src/components/AvatarUploader.tsx:42` | 428 | async/await/Promise @42; try/catch @81 | WU21 |
| `apps/web/src/components/ChannelComposerBar.tsx:43` | 84 | async/await/Promise @43; try/catch @49 | WU17 |
| `apps/web/src/components/ChannelPanel.tsx:89` | 563 | async/await/Promise @89; try/catch @98 | WU17 |
| `apps/web/src/components/ChatActionsMenu.tsx:30` | 119 | async/await/Promise @30; try/catch @32 | WU23 |
| `apps/web/src/components/ChatBackgroundDialog.tsx:137` | 467 | async/await/Promise @137; try/catch @172; timer @222 | WU23 |
| `apps/web/src/components/ChatHeader.tsx:52` | 321 | timer @52; async/await/Promise @100; try/catch @104 | WU23 |
| `apps/web/src/components/ChatList.tsx:250` | 444 | try/catch @250 (weak) | WU26 |
| `apps/web/src/components/ChatMediaPanel.tsx:218` | 379 | async/await/Promise @218; try/catch @219 | WU25 |
| `apps/web/src/components/Composer.tsx:383` | 1070 | timer @383; async/await/Promise @451; try/catch @453; fetch/WebSocket @454 | WU18 |
| `apps/web/src/components/ContactProfileRow.tsx:41` | 338 | async/await/Promise @41; try/catch @47 | WU24 |
| `apps/web/src/components/ExplorePage.tsx:59` | 277 | timer @59; async/await/Promise @68; try/catch @100 | WU24 |
| `apps/web/src/components/FolderEditorDialog.tsx:73` | 408 | async/await/Promise @73; try/catch @79 | WU22 |
| `apps/web/src/components/GifPanel.tsx:46` | 354 | async/await/Promise @46; try/catch @50; timer @225 | WU19 |
| `apps/web/src/components/GroupPanel.tsx:97` | 988 | async/await/Promise @97; try/catch @110 | WU15 |
| `apps/web/src/components/InviteDialog.tsx:20` | 82 | async/await/Promise @20; try/catch @25 | WU17 |
| `apps/web/src/components/InviteLinksSection.tsx:98` | 262 | async/await/Promise @98; try/catch @108 | WU17 |
| `apps/web/src/components/MarkdownText.tsx:14` | 55 | try/catch @14 (weak) | R3 |
| `apps/web/src/components/MessageBubble.tsx:470` | 841 | try/catch @470 (weak) | WU26 |
| `apps/web/src/components/MessageSearchResults.tsx:34` | 183 | async/await/Promise @34 | WU25 |
| `apps/web/src/components/NewGroupDialog.tsx:50` | 338 | timer @50; async/await/Promise @51; try/catch @100 | WU22 |
| `apps/web/src/components/NewTopicDialog.tsx:77` | 377 | async/await/Promise @77; try/catch @82 | WU22 |
| `apps/web/src/components/PackEditor.tsx:98` | 666 | try/catch @98; async/await/Promise @186 | WU20 |
| `apps/web/src/components/PinnedBanner.tsx:71` | 157 | async/await/Promise @71; try/catch @80 | WU25 |
| `apps/web/src/components/PinsPanel.tsx:40` | 168 | async/await/Promise @40; try/catch @48 | WU25 |
| `apps/web/src/components/ProfileSettingsSection.tsx:75` | 221 | timer @75; async/await/Promise @76; try/catch @108 | WU24 |
| `apps/web/src/components/StickerPanel.tsx:147` | 578 | try/catch @147; storage @148; async/await/Promise @180 | WU19 |
| `apps/web/src/components/TaskStrip.tsx:69` | 425 | try/catch @69; async/await/Promise @144 | WU25 |
| `apps/web/src/components/TelegramImportDialog.tsx:61` | 280 | async/await/Promise @61; try/catch @68 | WU20 |
| `apps/web/src/components/TopicPanel.tsx:94` | 1108 | async/await/Promise @94; try/catch @99 | WU16 |
| `apps/web/src/components/VisibilitySection.tsx:68` | 252 | timer @68; async/await/Promise @69; try/catch @105 | WU24 |
| `apps/web/src/components/VoiceMessage.tsx:90` | 309 | timer @90; async/await/Promise @156; try/catch @204 | WU21 |

**components/ais** (4 files, 1757 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/web/src/components/ais/AiActivity.tsx:114` | 287 | async/await/Promise @114; try/catch @115 | WU12 |
| `apps/web/src/components/ais/AiMemorySection.tsx:48` | 258 | async/await/Promise @48; try/catch @55 | WU12 |
| `apps/web/src/components/ais/AiPanel.tsx:189` | 880 | async/await/Promise @189; try/catch @207 | WU11 |
| `apps/web/src/components/ais/NewAiDialog.tsx:58` | 332 | async/await/Promise @58; try/catch @65 | WU12 |

**components/approvals** (1 files, 268 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/web/src/components/approvals/AlwaysAllowedList.tsx:118` | 268 | async/await/Promise @118; try/catch @151 | WU14 |

**components/auth** (1 files, 217 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/web/src/components/auth/AuthFlow.tsx:65` | 217 | timer @65; async/await/Promise @71 | WU4 |

**components/machines** (2 files, 458 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/web/src/components/machines/AddMachineDialog.tsx:32` | 208 | async/await/Promise @32; try/catch @40; timer @57 | WU8 |
| `apps/web/src/components/machines/ApprovedMachineCard.tsx:65` | 250 | async/await/Promise @65 | WU8 |

**components/tools** (3 files, 964 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/web/src/components/tools/RoutinesSection.tsx:91` | 284 | async/await/Promise @91; try/catch @92 | WU13 |
| `apps/web/src/components/tools/ToolDetailPanel.tsx:84` | 484 | async/await/Promise @84; try/catch @85; JSON.parse @157 | WU13 |
| `apps/web/src/components/tools/ToolsSection.tsx:73` | 196 | async/await/Promise @73; try/catch @74 | WU13 |

**lib** (20 files, 2523 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/web/src/lib/attachments.ts:76` | 309 | try/catch @76; async/await/Promise @181; timer @212 | WU3 |
| `apps/web/src/lib/background-image.ts:47` | 114 | async/await/Promise @47; try/catch @49 | WU2 |
| `apps/web/src/lib/blockedJids.ts:22` | 84 | async/await/Promise @22; try/catch @23 | WU2 |
| `apps/web/src/lib/clipboard.ts:5` | 37 | async/await/Promise @5; try/catch @7 | WU2 |
| `apps/web/src/lib/handleGate.ts:18` | 48 | try/catch @18; storage @19 | WU2 |
| `apps/web/src/lib/handles.ts:103` | 114 | async/await/Promise @103 | WU2 |
| `apps/web/src/lib/push.ts:85` | 300 | async/await/Promise @85; try/catch @211 | WU3 |
| `apps/web/src/lib/sticker-images.ts:85` | 241 | async/await/Promise @85; try/catch @144 | WU2 |
| `apps/web/src/lib/stickers.ts:41` | 125 | try/catch @41; JSON.parse @51 (weak) | WU2 |
| `apps/web/src/lib/topicsUi.ts:9` | 80 | try/catch @9; JSON.parse @14; storage @41 | WU2 |
| `apps/web/src/lib/useApprovalPolling.ts:58` | 221 | timer @58; async/await/Promise @162 | WU1 |
| `apps/web/src/lib/useChatFolders.ts:11` | 29 | async/await/Promise @11; try/catch @12 | WU1 |
| `apps/web/src/lib/useContactRequestCount.ts:21` | 44 | async/await/Promise @21; timer @33 | WU1 |
| `apps/web/src/lib/useDelayed.ts:14` | 22 | timer @14 | WU1 |
| `apps/web/src/lib/useIsServerOwner.ts:28` | 57 | async/await/Promise @28; try/catch @43 | WU1 |
| `apps/web/src/lib/useMessageSearch.ts:29` | 94 | timer @29; async/await/Promise @55 | WU1 |
| `apps/web/src/lib/usePendingApprovalCount.ts:27` | 51 | async/await/Promise @27 | WU1 |
| `apps/web/src/lib/usePeopleSearch.ts:52` | 131 | async/await/Promise @52; timer @87 | WU1 |
| `apps/web/src/lib/useVoiceTranscription.ts:24` | 52 | async/await/Promise @24; try/catch @39 | WU1 |
| `apps/web/src/lib/voice.ts:79` | 370 | async/await/Promise @79; try/catch @84 | WU3 |

**routes** (18 files, 4806 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/web/src/routes/AisPage.tsx:37` | 307 | async/await/Promise @37; try/catch @38 | WU7 |
| `apps/web/src/routes/ApprovalsPage.tsx:51` | 291 | timer @51; async/await/Promise @90; try/catch @94 | WU6 |
| `apps/web/src/routes/BlockedPage.tsx:20` | 121 | async/await/Promise @20; try/catch @26 | WU6 |
| `apps/web/src/routes/ChatShell.tsx:16` | 68 | try/catch @16 (weak) | R3 |
| `apps/web/src/routes/ConnectionsPage.tsx:44` | 375 | async/await/Promise @44; try/catch @45 | WU7 |
| `apps/web/src/routes/FoldersPage.tsx:81` | 239 | async/await/Promise @81; try/catch @87 | WU6 |
| `apps/web/src/routes/GroupHandleRoute.tsx:50` | 223 | timer @50; async/await/Promise @51; try/catch @157 | WU9 |
| `apps/web/src/routes/HandlePage.tsx:46` | 193 | timer @46; async/await/Promise @49; try/catch @83 | WU5 |
| `apps/web/src/routes/IntegrationsPage.tsx:70` | 525 | async/await/Promise @70; try/catch @77 | WU7 |
| `apps/web/src/routes/InvitePage.tsx:18` | 56 | async/await/Promise @18; try/catch @23 | WU5 |
| `apps/web/src/routes/JoinPage.tsx:28` | 249 | async/await/Promise @28; try/catch @66 | WU5 |
| `apps/web/src/routes/LoginPage.tsx:18` | 52 | async/await/Promise @18; try/catch @23 | WU4 |
| `apps/web/src/routes/MachinesPage.tsx:66` | 442 | async/await/Promise @66; try/catch @67 | WU8 |
| `apps/web/src/routes/NamePage.tsx:16` | 73 | async/await/Promise @16; try/catch @25 | WU4 |
| `apps/web/src/routes/NotificationsPage.tsx:42` | 519 | try/catch @42; storage @43; JSON.parse @47; async/await/Promise @136 | WU9 |
| `apps/web/src/routes/RequestsPage.tsx:26` | 171 | async/await/Promise @26; try/catch @33 | WU6 |
| `apps/web/src/routes/SetupPage.tsx:38` | 231 | async/await/Promise @38; try/catch @43 | WU5 |
| `apps/web/src/routes/StickersPage.tsx:115` | 671 | async/await/Promise @115; try/catch @118 | WU10 |

**store** (2 files, 6672 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/web/src/store/realStore.ts:414` | 4809 | try/catch @414; JSON.parse @419; storage @437; async/await/Promise @877 | WS1 |
| `apps/web/src/store/store.ts:554` | 1863 | try/catch @554; timer @716; async/await/Promise @901 | WS11 |

### apps/mobile: 119 files, 35258 lines


**modules** (3 files, 377 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/modules/zilar-whistle/src/download.ts:1` | 150 | native module import @1; async/await/Promise @34; try/catch @42 | MU5 |
| `apps/mobile/modules/zilar-whistle/src/transcribe.ts:13` | 193 | try/catch @13; async/await/Promise @61 | MU5 |
| `apps/mobile/modules/zilar-whistle/src/ZilarWhistleModule.ts:28` | 34 | try/catch @28 (weak) | R4 |

**app** (2 files, 397 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/app/_layout.tsx:24` | 74 | try/catch @24 (weak) | MU6 |
| `apps/mobile/src/app/explore.tsx:82` | 323 | timer @82; async/await/Promise @93; try/catch @101 | MU7 |

**app/(tabs)** (5 files, 1250 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/app/(tabs)/_layout.tsx:28` | 76 | async/await/Promise @28; try/catch @38 | MU6 |
| `apps/mobile/src/app/(tabs)/ais.tsx:67` | 249 | async/await/Promise @67; try/catch @71 | MU6 |
| `apps/mobile/src/app/(tabs)/index.tsx:84` | 499 | env read @84; async/await/Promise @174; try/catch @178 | MU6 |
| `apps/mobile/src/app/(tabs)/profile.tsx:52` | 219 | async/await/Promise @52; try/catch @58 | MU6 |
| `apps/mobile/src/app/(tabs)/settings.tsx:144` | 207 | async/await/Promise @144; try/catch @150 | MU6 |

**app/ais** (2 files, 711 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/app/ais/[id].tsx:84` | 345 | async/await/Promise @84; try/catch @101 | MU9 |
| `apps/mobile/src/app/ais/new.tsx:68` | 366 | async/await/Promise @68; try/catch @72 | MU9 |

**app/at** (1 files, 218 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/app/at/[handle].tsx:63` | 218 | timer @63; async/await/Promise @70; try/catch @75 | MU7 |

**app/chat** (1 files, 1095 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/app/chat/[id].tsx:188` | 1095 | env read @188; async/await/Promise @243; try/catch @248 | MU8 |

**app/dev** (1 files, 297 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/app/dev/whistle.tsx:65` | 297 | async/await/Promise @65; try/catch @67; timer @141 | R4 |

**app/group** (1 files, 720 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/app/group/[id].tsx:1` | 720 | native module import @1; try/catch @138; async/await/Promise @204; timer @309 | MU9 |

**app/invite** (1 files, 80 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/app/invite/[code].tsx:28` | 80 | async/await/Promise @28; try/catch @33 | MU7 |

**app/join** (1 files, 229 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/app/join/[token].tsx:119` | 229 | async/await/Promise @119; try/catch @128 | MU7 |

**app/settings** (11 files, 5148 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/app/settings/approvals.tsx:86` | 477 | timer @86; async/await/Promise @101; try/catch @105 | MU10 |
| `apps/mobile/src/app/settings/blocked.tsx:55` | 203 | async/await/Promise @55; try/catch @59 | MU10 |
| `apps/mobile/src/app/settings/connections.tsx:77` | 492 | async/await/Promise @77; try/catch @81 | MU11 |
| `apps/mobile/src/app/settings/folder/[id].tsx:131` | 292 | async/await/Promise @131; try/catch @132 | MU10 |
| `apps/mobile/src/app/settings/folders.tsx:72` | 185 | try/catch @72 (weak) | MU10 |
| `apps/mobile/src/app/settings/integrations.tsx:68` | 720 | async/await/Promise @68; try/catch @72 | MU11 |
| `apps/mobile/src/app/settings/machines.tsx:2` | 651 | native module import @2; async/await/Promise @89; try/catch @94 | MU12 |
| `apps/mobile/src/app/settings/profile.tsx:71` | 381 | async/await/Promise @71; try/catch @85; timer @111 | MU12 |
| `apps/mobile/src/app/settings/requests.tsx:63` | 289 | async/await/Promise @63; try/catch @68 | MU10 |
| `apps/mobile/src/app/settings/sticker-pack.tsx:121` | 819 | async/await/Promise @121; try/catch @157 | MU13 |
| `apps/mobile/src/app/settings/stickers.tsx:106` | 639 | async/await/Promise @106; try/catch @125 | MU13 |

**app/u** (1 files, 250 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/app/u/[handle].tsx:75` | 250 | async/await/Promise @75; try/catch @80 | MU7 |

**app/welcome** (1 files, 198 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/app/welcome/handle.tsx:69` | 198 | timer @69; async/await/Promise @70; try/catch @111 | MU7 |

**auth** (6 files, 583 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/auth/AuthFlow.tsx:48` | 222 | timer @48; async/await/Promise @54 | MU1 |
| `apps/mobile/src/auth/NameForm.tsx:28` | 99 | async/await/Promise @28 | MU1 |
| `apps/mobile/src/auth/secure-session-storage.ts:1` | 26 | native module import @1; async/await/Promise @14 | MU1 |
| `apps/mobile/src/auth/session-storage.ts:12` | 23 | async/await/Promise @12 | MU1 |
| `apps/mobile/src/auth/session-store.ts:79` | 143 | async/await/Promise @79; try/catch @81 | MU1 |
| `apps/mobile/src/auth/session.ts:18` | 70 | try/catch @18; async/await/Promise @23 | MU1 |

**components/ais** (10 files, 2189 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/components/ais/ai-activity.tsx:32` | 252 | async/await/Promise @32; try/catch @184 | MU14 |
| `apps/mobile/src/components/ais/ai-memory-section.tsx:55` | 364 | async/await/Promise @55; try/catch @61 | MU14 |
| `apps/mobile/src/components/ais/routines-section.tsx:65` | 338 | async/await/Promise @65; try/catch @66 | MU14 |
| `apps/mobile/src/components/ais/tool-actions.ts:46` | 90 | try/catch @46; JSON.parse @47 (weak) | R4 |
| `apps/mobile/src/components/ais/tool-detail-sheet.tsx:558` | 778 | async/await/Promise @558; try/catch @559 | MU15 |
| `apps/mobile/src/components/ais/tools-section.tsx:28` | 178 | async/await/Promise @28; try/catch @29 | MU15 |
| `apps/mobile/src/components/ais/use-ai-memory-api.ts:43` | 51 | env read @43 (weak) | R5 |
| `apps/mobile/src/components/ais/use-ais-api.ts:20` | 35 | env read @20 (weak) | R5 |
| `apps/mobile/src/components/ais/use-audit-api.ts:43` | 51 | env read @43 (weak) | R5 |
| `apps/mobile/src/components/ais/use-tools-api.ts:44` | 52 | env read @44 (weak) | R5 |

**components/approvals** (1 files, 178 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/components/approvals/rows.ts:132` | 178 | async/await/Promise @132 | MU25 |

**components/chat** (29 files, 8468 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/components/chat/approval-card.tsx:45` | 164 | async/await/Promise @45; try/catch @65 | MU22 |
| `apps/mobile/src/components/chat/attachment-body.tsx:133` | 194 | try/catch @133 (weak) | R4 |
| `apps/mobile/src/components/chat/attachment-video.tsx:69` | 279 | async/await/Promise @69; try/catch @233 | MU19 |
| `apps/mobile/src/components/chat/channel-composer-bar.tsx:111` | 141 | try/catch @111 (weak) | MU16 |
| `apps/mobile/src/components/chat/channel-screen.tsx:1` | 373 | native module import @1; async/await/Promise @122; try/catch @153 | MU17 |
| `apps/mobile/src/components/chat/composer.tsx:274` | 697 | async/await/Promise @274; try/catch @283; env read @294 | MU16 |
| `apps/mobile/src/components/chat/gif-panel.tsx:153` | 398 | async/await/Promise @153; timer @231; try/catch @349 | MU17 |
| `apps/mobile/src/components/chat/group-roles-sheet.tsx:72` | 303 | async/await/Promise @72 | MU20 |
| `apps/mobile/src/components/chat/invite-links-sheet.tsx:147` | 363 | async/await/Promise @147; try/catch @154 | MU20 |
| `apps/mobile/src/components/chat/invite-sheet.tsx:40` | 185 | async/await/Promise @40; try/catch @78 | MU20 |
| `apps/mobile/src/components/chat/jump-scroll.ts:23` | 75 | timer @23 | MU22 |
| `apps/mobile/src/components/chat/media-sheet.tsx:362` | 475 | async/await/Promise @362; try/catch @363 | MU19 |
| `apps/mobile/src/components/chat/message-bubble.tsx:8` | 744 | native module import @8; try/catch @360 | MU21 |
| `apps/mobile/src/components/chat/message-list.tsx:202` | 361 | timer @202 | MU21 |
| `apps/mobile/src/components/chat/message-search-list.tsx:108` | 234 | try/catch @108 (weak) | MU22 |
| `apps/mobile/src/components/chat/message-search.ts:135` | 421 | timer @135; async/await/Promise @260; fetch/WebSocket @350 | MU22 |
| `apps/mobile/src/components/chat/new-chat-button.tsx:87` | 269 | async/await/Promise @87; try/catch @125 | MU16 |
| `apps/mobile/src/components/chat/search-jump.ts:34` | 57 | async/await/Promise @34; try/catch @39 | MU22 |
| `apps/mobile/src/components/chat/skeleton.tsx:21` | 130 | timer @21 | MU22 |
| `apps/mobile/src/components/chat/sticker-message.tsx:43` | 92 | async/await/Promise @43 | MU21 |
| `apps/mobile/src/components/chat/sticker-panel.tsx:94` | 339 | async/await/Promise @94; try/catch @326 | MU17 |
| `apps/mobile/src/components/chat/swipe-to-reply.tsx:1` | 68 | native module import @1; try/catch @42 | MU22 |
| `apps/mobile/src/components/chat/use-approvals-api.ts:44` | 52 | env read @44 (weak) | R5 |
| `apps/mobile/src/components/chat/use-invites-api.ts:22` | 38 | env read @22 (weak) | R5 |
| `apps/mobile/src/components/chat/visibility-fields.tsx:146` | 335 | timer @146; async/await/Promise @151 | MU20 |
| `apps/mobile/src/components/chat/visibility-sheet.tsx:113` | 243 | timer @113; async/await/Promise @124 | MU20 |
| `apps/mobile/src/components/chat/voice-message.tsx:62` | 602 | async/await/Promise @62; try/catch @171 | MU18 |
| `apps/mobile/src/components/chat/voice-player.ts:48` | 410 | try/catch @48; async/await/Promise @104 | MU18 |
| `apps/mobile/src/components/chat/voice-recorder.tsx:76` | 426 | async/await/Promise @76; try/catch @99; timer @245 | MU18 |

**components/connections** (2 files, 88 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/components/connections/save-connection.ts:19` | 46 | async/await/Promise @19; try/catch @23 | MU25 |
| `apps/mobile/src/components/connections/use-connections-api.ts:24` | 42 | env read @24 (weak) | R5 |

**components/contacts** (6 files, 687 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/components/contacts/add-contact.ts:80` | 120 | async/await/Promise @80 | MU24 |
| `apps/mobile/src/components/contacts/blocks.ts:47` | 81 | async/await/Promise @47; try/catch @52 | MU24 |
| `apps/mobile/src/components/contacts/people-search.ts:61` | 213 | timer @61; fetch/WebSocket @163; async/await/Promise @168 | MU24 |
| `apps/mobile/src/components/contacts/requests.ts:39` | 59 | async/await/Promise @39; try/catch @45 | MU24 |
| `apps/mobile/src/components/contacts/use-contacts-api.ts:22` | 38 | env read @22 (weak) | R5 |
| `apps/mobile/src/components/contacts/use-people-search.ts:75` | 176 | try/catch @75; async/await/Promise @113 | MU24 |

**components/directory** (1 files, 39 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/components/directory/use-directory-api.ts:24` | 39 | env read @24 (weak) | R5 |

**components/integrations** (2 files, 186 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/components/integrations/card-save.ts:23` | 144 | async/await/Promise @23; try/catch @29 | MU25 |
| `apps/mobile/src/components/integrations/use-integrations-api.ts:24` | 42 | env read @24 (weak) | R5 |

**components/machines** (2 files, 74 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/components/machines/machine-change.ts:18` | 34 | async/await/Promise @18; try/catch @24 | MU25 |
| `apps/mobile/src/components/machines/use-machines-api.ts:24` | 40 | env read @24 (weak) | R5 |

**components/settings** (3 files, 573 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/components/settings/avatar-native.ts:1` | 284 | native module import @1; async/await/Promise @98; try/catch @119; JSON.parse @200 | MU25 |
| `apps/mobile/src/components/settings/profile-logic.ts:216` | 250 | try/catch @216 (weak) | R4 |
| `apps/mobile/src/components/settings/use-profile-api.ts:24` | 39 | env read @24 (weak) | R5 |

**components/stickers** (4 files, 880 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/components/stickers/pack-editor.ts:200` | 293 | async/await/Promise @200; try/catch @201 | MU23 |
| `apps/mobile/src/components/stickers/sticker-native.ts:1` | 213 | native module import @1; async/await/Promise @78; try/catch @79 | MU23 |
| `apps/mobile/src/components/stickers/telegram-import-sheet.tsx:75` | 333 | async/await/Promise @75; try/catch @78 | MU23 |
| `apps/mobile/src/components/stickers/use-stickers-api.ts:25` | 41 | env read @25 (weak) | R5 |

**lib** (19 files, 4292 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/lib/approval-state.ts:33` | 77 | async/await/Promise @33; try/catch @37 | MU2 |
| `apps/mobile/src/lib/attachment-native.ts:10` | 442 | native module import @10; async/await/Promise @88; try/catch @108 | MU4 |
| `apps/mobile/src/lib/attachments.ts:99` | 306 | try/catch @99 (weak) | R4 |
| `apps/mobile/src/lib/auth.ts:22` | 123 | env read @22; async/await/Promise @96 | MU2 |
| `apps/mobile/src/lib/blocked-users.ts:24` | 114 | async/await/Promise @24; try/catch @25 | MU2 |
| `apps/mobile/src/lib/drafts.ts:87` | 325 | try/catch @87; JSON.parse @88; fetch/WebSocket @151; timer @167 | MU3 |
| `apps/mobile/src/lib/emoji-data.ts:364` | 425 | try/catch @364; JSON.parse @365; async/await/Promise @400 | MU2 |
| `apps/mobile/src/lib/gifs.ts:118` | 131 | try/catch @118 (weak) | R4 |
| `apps/mobile/src/lib/markdown.ts:67` | 410 | try/catch @67 (weak) | R4 |
| `apps/mobile/src/lib/native-pitfalls-scan.ts:1` | 87 | node I/O import @1 | R4 |
| `apps/mobile/src/lib/polyfills.ts:24` | 50 | async/await/Promise @24 | MU2 |
| `apps/mobile/src/lib/session-token.ts:6` | 10 | async/await/Promise @6 | MU2 |
| `apps/mobile/src/lib/stickers-storage.ts:25` | 54 | async/await/Promise @25; try/catch @48 | MU2 |
| `apps/mobile/src/lib/stickers.ts:83` | 240 | try/catch @83; JSON.parse @134 (weak) | MU2 |
| `apps/mobile/src/lib/topics.ts:317` | 413 | try/catch @317 (weak) | R4 |
| `apps/mobile/src/lib/voice-native.ts:161` | 414 | async/await/Promise @161; try/catch @162 | MU4 |
| `apps/mobile/src/lib/voice-transcribe-flow.ts:120` | 253 | async/await/Promise @120; try/catch @130 | MU3 |
| `apps/mobile/src/lib/voice.ts:105` | 302 | async/await/Promise @105; try/catch @106 | MU3 |
| `apps/mobile/src/lib/whistle-port.ts:48` | 116 | try/catch @48; async/await/Promise @54 | MU3 |

**store** (3 files, 6051 lines)

| File:first line | Lines | What fails | Task |
| --- | ---: | --- | --- |
| `apps/mobile/src/store/chat-store-provider.tsx:47` | 99 | env read @47 (weak) | R5 |
| `apps/mobile/src/store/chat-store.ts:231` | 1595 | timer @231; async/await/Promise @257; try/catch @275; env read @1571 | MS10 |
| `apps/mobile/src/store/real-store.ts:435` | 4357 | async/await/Promise @435; try/catch @503; timer @1895 | MS1 |

## Appendix B: Phase 6 (optional), sinking the Promise edges

Only needed if D1 says Tier B must reach zero. The ratchet from R6 already stops it growing. Rough rows, to be split further when chosen (sizes are my guess, unverified):

| Id | Task | Scope | Days |
| --- | --- | --- | ---: |
| B1 to B5 | Web `lib/api.ts`: functions return `Effect`, `ApiError` as a tagged error, Promise exports removed; five serial slices of about 540 lines (140 exports, 2,691 lines) | `apps/web/src/lib/api.ts` plus callers that move to the Effect form | 2.5 |
| B6 to B10 | Mobile `lib/*-api.ts`: 25 clients in 5 batches | `apps/mobile/src/lib/*-api.ts` | 2.5 |
| B11 | Web `lib/tools.ts` (284 lines) and `lib/drafts.ts` (100 lines); the six raw `fetch` sites of `api.ts` are in B1 to B5 | `apps/web/src/lib` | 0.5 |
| B12 to B27 | Server: drop `export async` wrappers once the entry owns the runtime (91 Effect files with hard signals, 41,369 lines) | `apps/server/src/*` by module | 6 to 8 |

