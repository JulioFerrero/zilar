---
id: T-0013
title: Protocol v0 — zod schemas for Galena's chat payloads
status: todo
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
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-
