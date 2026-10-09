---
id: T-0770
title: "R2: effect-plain markers on 8 pure server files (connections/crypto, push/crypto, setup/crypto, actions/canonical, groups/events, web-tools/feed, web-tools/html, sandbox/ip-guard) — one comment line each with the reason; no code change"
status: merged
milestone: M5
branch: task/T-0770-server-markers
model: auto
effort: default
depends_on: []
estimate: 0.1 day
---

# T-0770 (R2): markers on the pure server files

## Spec (written by Claude, do not edit)

### Why
This is Phase 0 of `docs/audit/effect-100-plan.md` (task R2). These eight files do only synchronous, pure work. The map counts them as needs-effect only because of a try/catch that turns a parse or crypto failure into a value or a typed error, or because of a `node:` import used for a pure function. The plan's answer is an `effect-plain` marker.

### Verified facts (do not re-derive)
- **The marker** (T-0758, `packages/devtools/src/effect-map/generate.ts`): a comment `// effect-plain: <reason>` within the first 15 lines makes the file exempt. The budget is 25, and 1 is used today (`packages/chat-core/src/url.ts`, T-0765).
- **The eight files** (in `apps/server/src/`), with what the lead read:
  - `connections/crypto.ts`, `push/crypto.ts` and `setup/crypto.ts`: synchronous AES-GCM decrypt. A try/catch around `Buffer.from` and `decipher.final()` maps to `DecryptionError` (for example `connections/crypto.ts:69-93`).
  - `actions/canonical.ts`: `node:crypto` `createHash`, plus a try/finally that unwinds a Set (lines 56, 69).
  - `groups/events.ts`: listener isolation; `emitGroupAi` and `emitTopicAi` wrap each listener in a try/catch so one bad listener cannot break group management (lines 22, 49).
  - `web-tools/feed.ts` (line 137) and `web-tools/html.ts` (line 161): a total parse of a value inside a pure parser.
  - `sandbox/ip-guard.ts`: imports `isIP` from `node:net` (line 1), pure, plus a total IPv6 parse (lines 45-56).

### What to build
1. **Add one comment line** near the top of each file (within the first 15 lines, after any existing header comment): `// effect-plain: <reason>`, with a specific reason of at most 100 characters (for example `synchronous AES-GCM decrypt; failure is a typed DecryptionError`). Change nothing else.
2. **Before adding a marker, read each file in full.** If a file actually does I/O, waits or holds shared mutable state beyond what is listed above, do not mark it: list it in the Report instead.
3. **Run `pnpm effect:map`.** Report each file's kind (it should be `exempt`) and the new marker count.

### Read first
`AGENTS.md`, `docs/audit/effect-100-plan.md` §1.4, the eight files.

### Allowed files
`apps/server/src/connections/crypto.ts`, `apps/server/src/push/crypto.ts`, `apps/server/src/setup/crypto.ts`, `apps/server/src/actions/canonical.ts`, `apps/server/src/groups/events.ts`, `apps/server/src/web-tools/feed.ts`, `apps/server/src/web-tools/html.ts`, `apps/server/src/sandbox/ip-guard.ts`, `work/T-0770-server-markers.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- Each file that is truly pure has a marker with a specific reason; any file that is not is listed in the Report.
- No code changes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### Done
Added one `// effect-plain: <reason>` line to seven files. No other change: `git diff --stat` shows 7 files, 7 insertions, 0 deletions.

Markers and kinds (`pnpm effect:map` prints each as `exempt`):
- `connections/crypto.ts` (line 1): synchronous AES-GCM decrypt; failure is a typed DecryptionError
- `push/crypto.ts` (line 1): synchronous AES-GCM decrypt; failure is a typed PushDecryptionError
- `setup/crypto.ts` (line 14, after the header): synchronous AES-GCM decrypt; failure is a typed SettingsDecryptionError
- `actions/canonical.ts` (line 1): pure canonical JSON and SHA-256 hash; bad input is a typed CanonicalJsonError
- `web-tools/feed.ts` (line 6, after the header): pure RSS/Atom parse; malformed input is a result value, not an error
- `web-tools/html.ts` (line 8, after the header): pure HTML-to-text extraction; malformed input yields text, no I/O
- `sandbox/ip-guard.ts` (line 1): pure IP classification and total IPv6 parse; no I/O, failures are values

### Not marked
- `groups/events.ts` stays `needs-effect`. It holds module-level mutable state: the listener Sets `groupAiListeners` (line 9) and `topicAiListeners` (line 38), which `onGroupAi`/`onTopicAi` add to and remove from at runtime. `docs/audit/effect-100-plan.md` §1.4 (line 8) says a file that holds shared state must use Effect, and the "do not mark" rule in the spec covers shared mutable state. Question for Claude: confirm it stays unmarked (my reading), or tell me to mark it.

### Commands and results
- `pnpm install`: done.
- `pnpm effect:map`: `841 files, coverage 48.0% (effect 202, needs-effect 234, plain 302, exempt 103, legacy 0), tier B 128, markers 8/25`. Marker count went from 1 to 8 of the budget of 25.
- `pnpm exec prettier --write` on the 7 changed files: all unchanged.
- `pnpm gate` (from the worktree root): exit 0, `GATE PASS`. Steps: install (frozen) PASS, format PASS, lint PASS, typecheck PASS, effect PASS, tests @zilar/server PASS. Scope: `every changed file is inside the Allowed files`.
- I ran no separate single-file tests; the gate ran the @zilar/server tests.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the diff directly.
- **Markers:** 7 one-line comments with specific reasons, and no code change; the count is now 8 of 25.
- **`groups/events.ts` stays unmarked, rightly:** it holds module-level listener Sets (shared state), so it moves to an Effect PubSub in a later task.
- **Results:** coverage 48.0%, and the gate (with the effect step) passed.
