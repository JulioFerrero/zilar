---
id: T-0013
title: Protocol v0 — zod schemas for Galena's chat payloads
status: changes-requested
milestone: M0
branch: task/T-0013-protocol-payloads
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0001]
estimate: 1 day
---

# T-0013: Protocol v0 payload schemas

## Spec (written by Claude, do not edit)

### Goal
Define every structured payload that AIs and clients exchange inside chat messages as **zod schemas with TypeScript types**, plus a safe encode/decode for them. The server, the web app and the mobile app will all validate messages with these schemas, so they must be strict, well tested, and **never throw on bad input from the network**.

**Transport decision (made by Claude).** A payload is a JSON **envelope** `{ v: 0, type, data }`, carried as text inside our namespaced XMPP element (`urn:galena:agent:0`). This task only deals with the JSON. Wrapping it in XML comes later, in `xmpp-core`.

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md`:
  - §6.3 (our XMPP extension and payload types)
  - §6.7 (voice messages)
  - §8.2 (polls)
  - §9.3 (listener wake reasons)
  - §9.5 (handoff)
  - §9.6 (board and task states)
  - §15.3 (approval cards)
- `packages/protocol/src/handoff.ts` and its tests (the existing style to follow)

### Allowed files
- `packages/protocol/src/**`
- No new dependencies. zod is already there.
- **Do not touch** anything outside `packages/protocol/src`, including its `package.json`.

### Schemas to add
Put them in logical files under `packages/protocol/src/`, e.g. `common.ts`, `task.ts`, `approval.ts`, `payload.ts`. Export everything from `index.ts`.

| Name | Shape (all objects strict: unknown keys rejected) |
|---|---|
| `JidSchema` | Non-empty string, max 3071 chars, contains exactly one `@`, no whitespace. The existing handoff `from`/`to` must reuse it. |
| `IdSchema` | Non-empty string, max 128 chars |
| `IsoDateTimeSchema` | ISO 8601 datetime with timezone (zod v4 `z.iso.datetime({ offset: true })` or equivalent) |
| `CurrencySchema` | `'EUR' \| 'USD'` |
| `MoneySchema` | `{ currency, amount: number ≥ 0 }` |
| `TaskStateSchema` | `submitted \| working \| input-required \| completed \| failed \| canceled \| rejected` |
| `ArtifactRefSchema` | `{ kind: message \| screenshot \| pr \| preview \| file \| report, ref: IdSchema or URL string ≤ 2048 }`. The handoff must reuse it. |
| `TaskSchema` | `{ id, room: Jid, title: 1–200 chars, owner?: Jid, state, depends_on: Id[], acceptance: string[], budget?: { currency, max > 0 }, source_message_id?: Id, artifacts: ArtifactRef[] }` |
| `ApprovalRequestSchema` | `{ id, room: Jid, ai: Jid, action: 1–100 chars (e.g. "git.merge", "ads.campaign.start"), summary: 1–500 chars, details?: ≤ 20000 chars (diff/command), args_hash: 64 lowercase hex chars (sha256), worst_case_cost?: Money, requested_by: Jid, expires_at: IsoDateTime }` |
| `ApprovalDecisionSchema` | `{ approval_id: Id, decision: approve_once \| approve_always \| deny, note?: ≤ 500 chars, decided_by: Jid, decided_at: IsoDateTime }` |
| `ProgressSchema` | `{ ai: Jid, task_id?: Id, stage: 1–100 chars, detail?: ≤ 500 chars, percent?: integer 0–100 }` |
| `BoardUpdateSchema` | Discriminated union on `op`: `task.created { task }`, `task.updated { task }`, `decision.added { decision: { id, text 1–1000, author: Jid, source_message_id?: Id } }`, `artifact.added { artifact: ArtifactRef & { id } }`. Each also has `room: Jid`. |
| `PreviewSchema` | `{ ai: Jid, url: https or http URL, label?: ≤ 100, expires_at?: IsoDateTime }` |
| `CostSchema` | `{ ai: Jid, room?: Jid, amount: Money, tokens?: { input: int ≥ 0, output: int ≥ 0 } }` |
| `WakeReasonSchema` | `{ ai: Jid, score: number 0–1, reason: 1–300 chars, message_ids: Id[] (max 50) }` |
| `PollSchema` | `{ id, question: 1–300, options: 2–10 × { id, label 1–100 } with unique option ids, multiple: boolean, closes_at?: IsoDateTime }` |
| `PollVoteSchema` | `{ poll_id: Id, option_ids: Id[] (1–10, unique), voter: Jid }` |
| `VoiceMetaSchema` | `{ duration_ms: int 1–3600000, mime: string (e.g. audio/mp4), waveform: int 0–255 [] (1–128 items), transcript?: { text ≤ 20000, language?: 2–10 chars, source: 'api' \| 'local' } }` |

**Envelope: `PayloadSchema`**, a discriminated union on `type`. Every variant is `{ v: 0, type: <literal>, data: <schema> }`:

| `type` | `data` |
|---|---|
| `task` | TaskSchema |
| `handoff` | HandoffSchema |
| `approval.request` | ApprovalRequestSchema |
| `approval.decision` | ApprovalDecisionSchema |
| `progress` | ProgressSchema |
| `board.update` | BoardUpdateSchema |
| `preview` | PreviewSchema |
| `cost` | CostSchema |
| `wake` | WakeReasonSchema |
| `poll` | PollSchema |
| `poll.vote` | PollVoteSchema |
| `voice` | VoiceMetaSchema |

**Functions in `payload.ts`:**
- `encodePayload(p: Payload): string`
  - Validates with `PayloadSchema` (it throws only on programmer error, i.e. invalid input from our own code).
  - Returns compact `JSON.stringify` output.
- `decodePayload(raw: string): { ok: true; payload: Payload } | { ok: false; error: string }`
  - **Never throws.** Returns an error for:
    - input longer than `MAX_PAYLOAD_BYTES` (64 KiB, measured in UTF-8 bytes)
    - invalid JSON
    - an unknown `type`
    - an unsupported `v`
    - schema failures
  - The error string is short and human-readable, and must never echo more than 100 characters of the raw input.
- Export `MAX_PAYLOAD_BYTES` and the `Payload` type.
- Bump `protocolVersion` to `'0.2.0'`.

### Tests (Vitest, next to each file)
- For **every** schema: one valid example that parses, plus at least **two** invalid cases that fail. Pick realistic mistakes: wrong enum, out of range, missing field, extra key.
- `JidSchema` rejects: `"no-at"`, `"two@@signs"`, `"a@b c"`, and a string longer than 3071 chars.
- `PollSchema` rejects duplicate option ids. `PollVoteSchema` rejects duplicate `option_ids`.
- `ApprovalRequestSchema` rejects an uppercase or short `args_hash`.
- `decodePayload`:
  - round-trips an example of every `type` through `encodePayload`
  - returns `ok: false` without throwing for: garbage text, `"null"`, `"[]"`, `{"v":1,…}`, an unknown type, a valid envelope with invalid data, and a 70 KiB string
- The existing handoff tests must still pass after `from`/`to` switch to `JidSchema`.

### Acceptance criteria
- [ ] All schemas and functions above exist, are exported from `@galena/protocol`, and have their types (`z.infer`).
- [ ] Objects are strict (unknown keys rejected).
- [ ] `decodePayload` never throws. There's a test that feeds it a list of hostile inputs inside a `try` that fails the test if anything is thrown.
- [ ] `protocolVersion` is `'0.2.0'`, and the existing server and web tests still pass, since they import it.
- [ ] No `any`, no casts to silence the compiler (`as unknown as`), no new dependencies, only allowed files touched.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

### Out of scope
- XML serialization, XMPP code, database code.
- Changing any other package.

---

## Report (written by the worker when done)

### What I did
- Added the protocol payload schemas as zod v4 strict objects with `z.infer` types:
  - `common.ts`: `JidSchema` (non-empty, ≤3071, exactly one `@`, no whitespace), `IdSchema` (≤128), `IsoDateTimeSchema` (`z.iso.datetime({ offset: true })`), `CurrencySchema`, `MoneySchema` (amount ≥ 0), `BudgetSchema` (max > 0), `ArtifactKindSchema`, `ArtifactRefSchema` (`ref` = `IdSchema` ∪ URL ≤ 2048).
  - `task.ts`: `TaskStateSchema` (7 A2A states), `TaskSchema`, `DecisionSchema`, `BoardArtifactSchema` (`ArtifactRef & { id }`), `BoardUpdateSchema` (discriminated union on `op`: `task.created`, `task.updated`, `decision.added`, `artifact.added`; each has `room`).
  - `approval.ts`: `ApprovalRequestSchema` (64 lowercase hex `args_hash`), `ApprovalDecisionSchema`.
  - `progress.ts`: `ProgressSchema`, `PreviewSchema` (http/https URL), `CostTokensSchema`, `CostSchema`.
  - `wake.ts`: `WakeReasonSchema`.
  - `poll.ts`: `PollOptionSchema`, `PollSchema` (2–10 options, unique ids), `PollVoteSchema` (1–10 unique `option_ids`).
  - `voice.ts`: `VoiceTranscriptSchema`, `VoiceMetaSchema`.
- Added `payload.ts`: `PayloadSchema` (discriminated union on `type`, all 12 variants `{ v: 0, type, data }`), `Payload`, `MAX_PAYLOAD_BYTES` (64 KiB), `encodePayload` (validates via `PayloadSchema.parse`, compact `JSON.stringify`), and `decodePayload` (never throws; rejects too-large, invalid JSON, non-object, unknown `type`, unsupported `v`, and schema failures with short fixed messages that never echo the input).
- Updated `handoff.ts` to reuse `JidSchema` for `from`/`to` and `ArtifactRefSchema` for `artifacts`; also reused `IdSchema` for `task_id` and a shared `BudgetSchema`, and made the object strict.
- Updated `index.ts` to export everything and bumped `protocolVersion` to `0.2.0`.
- Added a Vitest file next to each schema module (valid example + ≥2 invalid cases each), plus the required `JidSchema`, `PollSchema`/`PollVoteSchema` uniqueness, and `ApprovalRequestSchema` hash tests, round-trips for every payload `type`, the decode failure cases, a hostile-input `try`/`catch` test, and a UTF-8 byte-count test.

### Files changed
- Modified: `packages/protocol/src/handoff.ts`, `packages/protocol/src/index.ts`, `packages/protocol/src/version.ts`, `work/T-0013-protocol-payloads.md` (status + this report).
- Added: `packages/protocol/src/common.ts`, `task.ts`, `approval.ts`, `progress.ts`, `wake.ts`, `poll.ts`, `voice.ts`, `payload.ts` and their `.test.ts` files (`common.test.ts`, `task.test.ts`, `approval.test.ts`, `progress.test.ts`, `wake.test.ts`, `poll.test.ts`, `voice.test.ts`, `payload.test.ts`).

### Commands run and real results
- `pnpm install`: "Lockfile is up to date, resolution step is skipped. Already up to date. Done in 448ms".
- `pnpm format:check`: "All matched files use Prettier code style!" (exit 0).
- `pnpm lint`: "Found 0 warnings and 0 errors. Finished in 8ms on 28 files with 127 rules" (exit 0).
- `pnpm typecheck`: "Tasks: 3 successful, 3 total" (protocol cache miss, web/server cache hit).
- `pnpm exec turbo typecheck --force` (cache bypass): "Tasks: 3 successful, 3 total, 0 cached" — `@galena/protocol`, `@galena/web`, `@galena/server` all pass.
- `pnpm test`: "Tasks: 3 successful, 3 total"; `@galena/protocol` 122 passed (9 files), `@galena/server` 2 passed, `@galena/web` 3 passed.
- `pnpm exec turbo test --force` (cache bypass): `@galena/protocol` 122 passed, `@galena/server` 2 passed, `@galena/web` 3 passed. Includes the 6 existing handoff tests.
- During development one test failed: `PreviewSchema` rejected `http://localhost:3000` because `z.httpUrl()` requires a dotted host. Fixed by using `z.url({ protocol: /^https?$/ })`, which accepts `http://localhost:3000`/`http://127.0.0.1:3000` and still rejects `ftp://`/`mailto:`.

### Problems, deviations from the spec, open questions
- Deviation (small, within scope): `handoff.ts` `task_id` now uses `IdSchema` (max 128), the handoff object is strict, and its `budget` uses the shared `BudgetSchema` instead of an inline duplicate. The spec only required `from`/`to` → `JidSchema` and `artifacts` → `ArtifactRefSchema`; the extra reuse keeps the schemas consistent and all handoff tests still pass.
- Implementation note: UTF-8 byte length in `decodePayload` is computed with a small local `utf8ByteLength` helper. `TextEncoder` is not available under this package's `lib: ["ES2023"]` tsconfig (no DOM/global node types), and the helper keeps the module runtime-agnostic (no Node `Buffer`). `prettier`/`oxlint` pass.
- No open questions. No new dependencies; only allowed files touched; no `any`, no `as unknown as`, no `@ts-ignore`, no disabled checks.

---

## Review (written by Claude)

**Verdict (round 1): changes requested.** The work is strong overall: every schema is strict, there are 122 tests, and `decodePayload` held up against hostile inputs. One security issue has to be fixed before clients can render these payloads.

### What I verified myself (on commit f7b4549)
- `install`, `format:check`, `lint`, `typecheck`, `test` (122 + 2 + 3) and `build`: all PASS.
- Independent probes (a temporary test file, since removed):

  | Probe | Result |
  |---|---|
  | Extra key on `BoardArtifactSchema` | rejected ✓ |
  | `__proto__` key in an envelope | rejected ✓ |
  | 30,000-deep nested JSON | rejected, no throw ✓ |
  | 50 MB string | rejected in ~262 ms (see finding 2) |
  | **`ArtifactRef` with `javascript:alert(1)`, `javascript:` + 200 chars, `data:text/html,…`** | **accepted ✗** |

### Findings
1. **(must fix, security) Artifact refs accept `javascript:` and `data:` URLs.**
   - Why: `ref` is `IdSchema ∪ z.url()`.
     - `IdSchema` accepts any short string, including `javascript:alert(1)`.
     - `z.url()` accepts any scheme.
   - The risk: a malicious or tricked AI could post a `pr` or `preview` artifact that turns into a script link in the web app.
   - Fix:
     - (a) Restrict `IdSchema` to URL-safe unreserved characters `^[A-Za-z0-9._~-]+$` (still 1–128). Note: this also forbids `:` in ids.
     - (b) Make the URL branch of `ArtifactRefSchema.ref` accept **http/https only**, the same way `PreviewSchema` does.
   - Add tests showing that `javascript:`, `data:`, `vbscript:` and `file:` refs are rejected, an http(s) URL is accepted, and ids containing `:` or spaces are rejected.
   - Check that the handoff tests and the existing examples still pass. If any existing example id breaks, keep the change and update the test data.
2. **(should fix, robustness) Reject oversized input before counting bytes.**
   - Add a fast path: `if (raw.length > MAX_PAYLOAD_BYTES) return too-large`. It's safe because UTF-8 bytes ≥ UTF-16 code units.
   - Make `utf8ByteLength` stop as soon as it passes the limit.
   - Add a correctness test for a 70 KiB ASCII string and one for a multi-byte string just over the limit. No timing assertions.
3. **(nit) `VoiceMetaSchema.mime`**: require it to start with `audio/`, max 100 chars, and add a test.
4. **(accepted)** Reusing `IdSchema`, `BudgetSchema` and a strict object in the handoff is a good improvement. The local `utf8ByteLength` helper is a reasonable way to avoid DOM and Node types.
5. **(doc)** Add a one-line comment on `JidSchema`: **bare JIDs only** (`local@domain`). Full JIDs with a resource aren't accepted by design.
