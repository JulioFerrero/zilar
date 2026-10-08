---
id: T-0603
title: "Tool args T-B: the eight model tool-argument schemas in agents/tools.ts zod to Effect Schema; rejection reasons name the field and problem from keys/tags only (never a value), following the plan's §2 walker and §3.2 table as closely as practical; tests unchanged"
status: todo
milestone: M5
branch: task/T-0603-agent-tool-args-effect
model: auto
effort: low
depends_on: [T-0594]
estimate: 1 day
---

# T-0603: the model tool arguments on Effect Schema (plan task T-B)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect Schema replaces zod. The plan is `docs/audit/tool-args-schema-plan.md` (§1.2, §2, §3.2 and §4 T-B). Its open findings, `docs/audit/tool-args-schema-plan-open-findings.md` (items 2-6), are about the §2 walker: **read them, and fix what applies.**

### Verified facts (do not re-derive)
**`apps/server/src/agents/tools.ts`** (zod import at the top). The eight strict schemas:
- `UpdatePersonaArgsSchema` (29-34);
- `RevertPersonaArgsSchema` (36);
- `RecallArgsSchema` (38-42);
- `MemoryZoomArgsSchema` (46-50), with the block regex `/^\d{1,9}-\d{1,9}$/`;
- `RememberArgsSchema` (52-56);
- `DelegateArgsSchema` (62-70);
- `TaskStatusArgsSchema` (72-76);
- `RequestActionArgsSchema` (82-87): `action` trimmed, 1..`ACTION_NAME_MAX_LENGTH`, matching `ACTION_NAME_PATTERN`; `args` is `z.record(z.string(), z.unknown())`. **An array or a primitive for `args` must be rejected.**

They feed `UpdatePersonaArgs` and `RequestActionArgs` (89-90) and `parseToolArguments` (decodes at 163-230). On failure it returns `{ ok: false, reason: firstIssue(error) }`, where `firstIssue` (240-242) is the first zod issue message.

**The rule that matters.** The `reason` goes back to the **model**. `apps/server/src/agents/tools.test.ts:135-143` and `160-168` assert that **no argument value is ever echoed** in a reason; this is security-relevant. No test pins zod's own wording (the lead checked: grep finds no "Invalid input", "Too small" or "Unrecognized key" in `agents/*.test.ts`). The pinned texts are hand-written: `arguments are not valid JSON` and `unknown tool: ...`.

**The lead's decision.**
- **Build reasons from keys, schema tags and annotations only, never from values.**
- Follow the plan's §2 walker and §3.2 table as closely as practical (field name plus problem, for example `Invalid input: expected string, received undefined`, or `Unrecognized key: "x"`).
- Exact zod parity is **not** required where Effect's issue tree makes it awkward, such as the ordering nit or an `AnyOf` with no child issues. In those cases a short, clear text like `persona: too long` is fine.
- In the Report, list for each of the eight schemas the reason for three inputs: a missing required key, a wrong type, and an extra key.

**Decode options.** All eight are `.strict()` in zod, so decode with `onExcessProperty: 'error'`. `.trim()` before the length checks becomes `Schema.Trim.check(...)` (the codebase idiom, `apps/server/src/ais/api.ts:114`). `args` becomes `Schema.Record(Schema.String, Schema.Unknown)`; check that it rejects `[]`, and say how.

**The helper.** Put the walker in `apps/server/src/agents/tools.ts`, or in a new `apps/server/src/agents/tool-arg-issues.ts` if it is long. `decodeActionArgs` in `actions/registry.ts` stays as it is, since it needs no message.

**Tests (all unchanged):**
- `apps/server/src/agents/tools.test.ts`;
- `apps/server/src/agents/reply.test.ts`;
- `apps/server/src/agents/gateway.test.ts`;
- `apps/server/src/agents/integration.test.ts`.

### What to build
1. **Convert the eight schemas and the two exported types** (`UpdatePersonaArgs` and `RequestActionArgs` keep their names and shapes).
2. **Replace `firstIssue`** with the key-and-tag-only walker.
3. **`agents/tools.ts`** ends with no zod import.
4. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` ("Effect 4 facts" and "Schema, custom messages"), `docs/audit/tool-args-schema-plan.md` (§1.2, §2, §3.2 and §4 T-B), `docs/audit/tool-args-schema-plan-open-findings.md`, `apps/server/src/xmpp/config.ts` (lines 60-100, the codebase walker), `apps/server/src/agents/tools.ts` and `apps/server/src/agents/tools.test.ts`.

### Allowed files
`apps/server/src/agents/tools.ts`, `apps/server/src/agents/tool-arg-issues.ts`, `work/T-0603-agent-tool-args-effect.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/tools agents/reply agents/gateway agents/integration
pnpm gate
```

### Acceptance
- The eight model tool schemas are on Effect Schema, and the rejection reasons name the field and problem without ever echoing a value.
- The Report includes the reasons table.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
