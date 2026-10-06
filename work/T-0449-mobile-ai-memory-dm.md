---
id: T-0449
title: "AI memory M6a (mobile): a Memory section on the AI screen shows what the AI remembers in the owner's DM; forget a fact, clear memory"
status: todo
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

## Review (written by Claude)
