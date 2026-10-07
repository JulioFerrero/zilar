---
id: T-0449
title: "AI memory M6a (mobile): a Memory section on the AI screen shows what the AI remembers in the owner's DM; forget a fact, clear memory"
status: merged
milestone: M5
branch: task/T-0449-mobile-ai-memory-dm
model: auto
effort: low
depends_on: [T-0441, T-0443]
estimate: 0.4 day
---

# T-0449: mobile — the AI's memory on the AI screen

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/ai-memory-plan.md` §3.6 (M6, DM part): the mobile twin of web T-0443 (`apps/web/src/components/ais/AiMemorySection.tsx`).

The server contract (T-0441) is:
- **`GET /api/ai-memory?chat=<jid>&ai=<aiId>`** returns `{ facts: { id, text }[], lines: string[], canChange: boolean }`;
- **`DELETE /api/ai-memory/facts/:id?chat=<jid>&ai=<aiId>`** returns `{ ok: true }`;
- **`POST /api/ai-memory/clear`**, JSON body `{ chat, ai }`, returns `{ ok: true }`.

For a DM, `chat` is the AI's JID.

### Verified facts (do not re-derive)
- **`apps/mobile/src/app/ais/[id].tsx`** is the AI edit screen (owner only):
  - it loads `loaded: PublicAi | null` (line 50), and `PublicAi` has `jid` (`apps/mobile/src/lib/ais-api.ts`);
  - the ready view ends with `<ToolsSection …/>`, `<RoutinesSection …/>` and `<AiActivity api={auditApi} aiId={id} />` (lines 323-325);
  - the audit API comes from `const { api: auditApi } = useAuditApi()` (line 45).
- **The API pattern to copy:**
  - `apps/mobile/src/lib/audit-api.ts`: an interface, an `…ApiError` class, type-guard parsing (mobile has no zod), and `createAuditApi(getToken, fetchImpl = fetch, apiUrl = API_URL)` (line 168);
  - `apps/mobile/src/components/ais/use-audit-api.ts`: the hook that picks the mock or the real API;
  - `apps/mobile/src/mock/audit.ts`: the mock.
- **The section pattern to copy:** `apps/mobile/src/components/ais/ai-activity.tsx` (`StateMessage`, `Button`, `Text`, and fixed error sentences as exported constants), with its test `ai-activity.test.tsx`.
- **Kit:**
  - `ConfirmDialog({ visible, title, message, error?, confirmLabel, busyLabel?, busy?, onCancel, onConfirm, … })` (`apps/mobile/src/components/ui/confirm-dialog.tsx:35`);
  - `StateMessage` and `Button` in `components/ui`.
  - **Every label goes inside `<Text>`.** Icons come from `lucide-react-native`.

### What to build
1. **New `apps/mobile/src/lib/ai-memory-api.ts`:**
   - `AiMemory { facts: { id: string; text: string }[]; lines: string[]; canChange: boolean }` with a type-guard parser;
   - the `AiMemoryApi` interface `{ getMemory(chat, aiId); forgetFact(chat, aiId, factId); clear(chat, aiId) }`;
   - `AiMemoryApiError` and `createAiMemoryApi(getToken, fetchImpl = fetch, apiUrl = API_URL)`, copying `audit-api.ts`. Use `URLSearchParams` and `encodeURIComponent` for the fact id.

   Tests go in `ai-memory-api.test.ts`: the URLs, methods, body, the bearer header, a malformed response, and a 403 becoming `AiMemoryApiError` with code `forbidden`.
2. **New `apps/mobile/src/mock/ai-memory.ts`:** `createMockAiMemoryApi()`, in memory, with the same seed as the web mock: the facts "Julio prefers short answers." and "The launch is on Friday.", one `#0-15 …` line and two `#16 2026-10-01 Julio: …` lines, and `canChange: true`.
3. **New `apps/mobile/src/components/ais/use-ai-memory-api.ts`:** a copy of `use-audit-api.ts` for this API.
4. **New `apps/mobile/src/components/ais/ai-memory-section.tsx`:** `AiMemorySection({ api, chat, aiId, aiName })`, with the same behaviour and texts as web T-0443:
   - **Closed:** the heading "Memory", the help line `What ${aiName} remembers from this chat. It reads this before replying.`, and a ghost `Button` "Show memory" (Brain icon). **No request until it is pressed.**
   - **Open:**
     - loading, then an error `StateMessage` "Could not load the memory" with Retry;
     - **"Pinned facts":** the rows, each with a Trash2 icon button (`accessibilityLabel` "Forget this fact") when `canChange`. The empty text is "Nothing pinned yet.", and a failure shows "Could not forget that fact".
     - **"Earlier in this chat":** the lines with `^#\d+(?:-\d+)? ` stripped. The empty text is "Nothing older than the recent messages yet."
     - **when `canChange`,** "Clear memory" opens the `ConfirmDialog`:
       - title "Clear memory?";
       - message `${aiName} forgets the pinned facts and the summaries of this chat. The messages stay, and it still reads the recent ones.`;
       - confirmLabel "Clear".

       Confirm clears, then reloads. A failure shows "Could not clear the memory".
     - "Hide memory" closes it.
5. **`app/ais/[id].tsx`:** `const { api: memoryApi } = useAiMemoryApi();` and, before `<ToolsSection …/>`, `{loaded !== null ? <AiMemorySection api={memoryApi} chat={loaded.jid} aiId={id} aiName={loaded.name} /> : null}`.
6. **New `apps/mobile/src/components/ais/ai-memory-section.test.tsx`** (fake `AiMemoryApi` with `vi.fn()`):
   - no call before Show memory;
   - the facts and the stripped lines render;
   - Forget calls `forgetFact` and removes the row;
   - Clear confirms: Cancel does nothing, Clear calls `clear` and reloads;
   - `canChange: false` hides Forget and Clear;
   - the empty texts;
   - an error with Retry.

### Read first
`AGENTS.md`, `apps/web/src/components/ais/AiMemorySection.tsx` (the behaviour to mirror), `apps/mobile/src/lib/audit-api.ts`, `apps/mobile/src/components/ais/use-audit-api.ts`, `apps/mobile/src/mock/audit.ts`, `apps/mobile/src/components/ais/ai-activity.tsx`, `apps/mobile/src/components/ais/ai-activity.test.tsx`, `apps/mobile/src/app/ais/[id].tsx:35-80` and `:315-337`, `apps/mobile/src/components/ui/confirm-dialog.tsx`.

### Allowed files
`apps/mobile/src/lib/ai-memory-api.ts`, `apps/mobile/src/lib/ai-memory-api.test.ts`, `apps/mobile/src/mock/ai-memory.ts`, `apps/mobile/src/components/ais/use-ai-memory-api.ts`, `apps/mobile/src/components/ais/ai-memory-section.tsx`, `apps/mobile/src/components/ais/ai-memory-section.test.tsx`, `apps/mobile/src/app/ais/[id].tsx`, `work/T-0449-mobile-ai-memory-dm.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot ai-memory
pnpm gate
```

### Acceptance
- The AI screen has a Memory section that loads on demand. It shows the facts and the earlier lines, and the owner can forget a fact and clear the memory after confirming.
- Mock mode works.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Mobile twin of web T-0443: a collapsible Memory section on the AI edit screen,
loaded on demand, in the owner's DM.

- `apps/mobile/src/lib/ai-memory-api.ts` (new): `AiMemory`/`AiMemoryFact`, the
  `AiMemoryApi` interface (`getMemory`, `forgetFact`, `clear`), `AiMemoryApiError`
  and `createAiMemoryApi(getToken, fetchImpl, apiUrl)` copied from `audit-api.ts`,
  with a type-guard parser. `GET /api/ai-memory?chat&ai`,
  `DELETE /api/ai-memory/facts/:id?chat&ai` (fact id `encodeURIComponent`) and
  `POST /api/ai-memory/clear` with body `{ chat, ai }`. Token is required on all
  three calls.
- `apps/mobile/src/lib/ai-memory-api.test.ts` (new): URLs, methods, clear body,
  bearer header, malformed response, 403 → `AiMemoryApiError` with code
  `forbidden`, and the no-session 401.
- `apps/mobile/src/mock/ai-memory.ts` (new): `createMockAiMemoryApi()`, in-memory,
  same seed as the web mock (facts "Julio prefers short answers." / "The launch is
  on Friday."; lines `#0-15 …`, `#16 2026-10-01 Julio: …`, `#17 2026-10-01 Dev-1: …`;
  `canChange: true`). Forget and Clear mutate the copy like the server.
- `apps/mobile/src/components/ais/use-ai-memory-api.ts` (new): copy of
  `use-audit-api.ts` (same `?mock=` / `EXPO_PUBLIC_ZILAR_MOCK` gate).
- `apps/mobile/src/components/ais/ai-memory-section.tsx` (new): `AiMemorySection`
  with the web behaviour and texts. Closed by default with the help line and a
  ghost `Show memory` (Brain) button; the `useEffect` is gated by `open`, so no
  request happens until it is pressed. Open: loading / error `StateMessage`
  "Could not load the memory" + Retry, "Pinned facts" (Trash2 button labelled
  "Forget this fact" only when `canChange`; "Nothing pinned yet."), "Earlier in
  this chat" (strip `^#\d+(?:-\d+)? `; "Nothing older than the recent messages
  yet."), the "Clear memory" `ConfirmDialog` (title/message/confirmLabel as the
  spec) and "Hide memory". Exports the fixed sentences, a presentational
  `AiMemorySectionContent`, and the helpers `removeFact`,
  `forgetAiMemoryFact` (server forget then fold the row out) and `clearAiMemory`
  (clear then reload).
- `apps/mobile/src/components/ais/ai-memory-section.test.tsx` (new): no call
  before Show memory, facts + stripped lines, Forget wiring and row removal via
  `forgetAiMemoryFact`, Clear via `clearAiMemory` (clear then reload) and the
  dialog props/handlers (Cancel closes, Clear confirms), `canChange: false` hides
  Forget and Clear, the empty texts, the load error with Retry, the inline forget
  and clear alerts, and the mock API.
- `apps/mobile/src/app/ais/[id].tsx`: `useAiMemoryApi()` and, before
  `<ToolsSection …/>`, `{loaded !== null ? <AiMemorySection api={memoryApi}
  chat={loaded.jid} aiId={id} aiName={loaded.name} /> : null}`.

### Files changed

All inside the task's Allowed files:
`apps/mobile/src/lib/ai-memory-api.ts`,
`apps/mobile/src/lib/ai-memory-api.test.ts`,
`apps/mobile/src/mock/ai-memory.ts`,
`apps/mobile/src/components/ais/use-ai-memory-api.ts`,
`apps/mobile/src/components/ais/ai-memory-section.tsx`,
`apps/mobile/src/components/ais/ai-memory-section.test.tsx`,
`apps/mobile/src/app/ais/[id].tsx`,
`work/T-0449-mobile-ai-memory-dm.md`.

### Commands and real results

- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot ai-memory`
  → `Test Files 2 passed (2)`, `Tests 21 passed (21)`.
- `pnpm gate` from the repo root:

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (2.6s)
PASS  format  (29.9s)
PASS  lint  (0.9s)
PASS  typecheck  (11.6s)
PASS  tests @zilar/mobile  (3.4s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Deviations / notes

- The mobile test harness renders with `renderToStaticMarkup`, so effects never
  run (see `ai-activity.test.tsx` and `routines-section.test.tsx`). The
  interactive behaviour is therefore covered the way those sections do it: the
  presentational `AiMemorySectionContent` for every state and handler wiring, plus
  the exported `forgetAiMemoryFact` / `clearAiMemory` helpers with a `vi.fn()`
  fake API. "No call before Show memory" is asserted on the stateful
  `AiMemorySection` (its `open` flag starts false and its effect is gated).
- `ConfirmDialog` in this app requires `busy` and `busyLabel` (the spec wrote
  them optional), so the section passes `busy={false}` and `busyLabel="Clearing…"`.
- The "Clear memory" trigger is an outline button with `text-danger`; the dialog
  uses the kit `ConfirmDialog` (not `Alert`).

### Blocked / needs a decision

None.

### Fix round 1

- `forget` now removes the fact with a functional update
  (`setMemory((current) => current === null ? current : removeFact(current, factId))`)
  and a synchronous `forgettingRef` guard, so two quick Forget taps can no longer
  bring a removed fact back. A `forgettingId` state disables that row's Forget
  button while its forget is pending, and `requestForgetFact` treats an
  `AiMemoryApiError` with status 404 as success (no row, no error); any other
  failure still shows "Could not forget that fact".
- Tests: `removeFact` (one removed, the others kept; removing the same id twice
  is harmless), `requestForgetFact` (calls the API; 404 resolves; other errors
  rethrow) and the disabled pending row.
- Commands: `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot
  ai-memory` → 2 files, 26 passed; `pnpm gate` → `GATE PASS`.

## Review (written by Claude)

Approved (lead, 2026-10-07) after one lead fix round (two quick Forget taps could bring a removed fact back; now a functional update with removeFact, a disabled row while pending, and 404 as success). The AI screen has a Memory section that loads on demand through ai-memory-api.ts (type guards, bearer, fixed errors) and a mock with the web seed. It shows the facts with Forget, the stripped earlier lines and Clear memory behind ConfirmDialog. Not checked on the emulator yet. Nit for a later pass: the "no request before Show memory" test cannot run effects in this harness.
