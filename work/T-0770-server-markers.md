---
id: T-0770
title: "R2: effect-plain markers on 8 pure server files (connections/crypto, push/crypto, setup/crypto, actions/canonical, groups/events, web-tools/feed, web-tools/html, sandbox/ip-guard) — one comment line each with the reason; no code change"
status: todo
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

## Review (written by Claude)
