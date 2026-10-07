---
id: T-0451
title: "AI memory M6b (mobile): each AI in the topic info sheet opens a 'What <AI> remembers' sheet"
status: todo
milestone: M5
branch: task/T-0451-mobile-ai-memory-rooms
model: auto
effort: low
depends_on: [T-0449]
estimate: 0.3 day
---

# T-0451: mobile — the AI's memory of a room

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/ai-memory-plan.md` §3.6 (M6, rooms): the mobile twin of web T-0447. Every member who sees a topic can see what an AI remembers there. Forget and Clear show only when the server answers `canChange` (T-0441).

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ais/ai-memory-section.tsx`:**
  - `AiMemorySection({ api, chat, aiId, aiName })` (lines 237-247) starts closed: `useState(false)` at line 248;
  - the pure view is `AiMemorySectionContent({ state, aiName, actions })` (line 85).
- **`apps/mobile/src/components/ais/use-ai-memory-api.ts`:** `useAiMemoryApi()` returns `{ api }` (T-0449).
- **`apps/mobile/src/components/chat/topic-sheets.tsx`:**
  - `TopicInfoSheet` (line 131) takes `ais: { id: string; name: string }[]` (line 160);
  - it renders each AI as a row with `Avatar` and the name `Text` at lines 246-253, under "AIs in this topic ({aiCount})".
- **`apps/mobile/src/app/chat/[id].tsx`:**
  - `infoAis` state (line 171) is filled by `listTopicAis(chat.id)` in `openInfo` (lines 467-475);
  - `<TopicInfoSheet chat={infoOpen ? chat : null} … ais={infoAis} …>` starts at line 996;
  - `chat.id` is the topic's room JID.
- **Kit:** `BottomSheet({ visible, onClose, closeLabel, title?, maxHeightClassName?, children? })` (`apps/mobile/src/components/ui/bottom-sheet.tsx:8-17`). **Every label goes inside `<Text>`.** Icons come from `lucide-react-native`; use `Brain`.
- **Tests:** `apps/mobile/src/components/chat/topic-sheets-roles.test.tsx:108` renders `TopicInfoSheet` with `createElement`; that is the harness to copy.

### What to build
1. **`ai-memory-section.tsx`:** a new optional prop `initiallyOpen?: boolean` (default false). When true, the section starts open and loads at once, with no Show or Hide button.
2. **New `apps/mobile/src/components/ais/ai-memory-sheet.tsx`:** `AiMemorySheet({ api, chat, ai, onClose })`, where `ai` is `{ id, name } | null`. It renders `<BottomSheet visible={ai !== null} onClose={onClose} closeLabel="Close memory" title={\`What ${name} remembers\`}>` with `<AiMemorySection … initiallyOpen />` inside when `ai` is set.
3. **`TopicInfoSheet`:**
   - a new optional prop `onOpenAiMemory?: (ai: { id: string; name: string }) => void`;
   - when it is set, each AI row ends with a `Pressable` icon button (Brain, `accessibilityRole="button"`, `accessibilityLabel={\`What ${ai.name} remembers\`}`) that calls it.
4. **`[id].tsx`:**
   - `const { api: memoryApi } = useAiMemoryApi();` and `const [memoryAi, setMemoryAi] = useState<{ id: string; name: string } | null>(null)`;
   - pass `onOpenAiMemory={(ai) => { setInfoOpen(false); setMemoryAi(ai); }}` to `TopicInfoSheet`, so the info sheet closes first and two sheets never stack;
   - render `<AiMemorySheet api={memoryApi} chat={chat.id} ai={memoryAi} onClose={() => setMemoryAi(null)} />` next to it.
5. **Tests:**
   - `ai-memory-section.test.tsx`: with `initiallyOpen`, the rendered content has no Show memory button;
   - **new `ai-memory-sheet.test.tsx`:** the title, and nothing rendered with `ai={null}`;
   - **new `topic-sheets-memory.test.tsx`** (copy the `topic-sheets-roles.test.tsx` harness): with `onOpenAiMemory`, each AI row has the "What <name> remembers" button and pressing it calls the prop with that AI; without the prop there is no button.

### Read first
`AGENTS.md`, `work/T-0447-web-ai-memory-rooms.md`, `apps/mobile/src/components/ais/ai-memory-section.tsx`, `apps/mobile/src/components/ais/ai-memory-section.test.tsx:1-80`, `apps/mobile/src/components/ais/use-ai-memory-api.ts`, `apps/mobile/src/components/chat/topic-sheets.tsx:120-260`, `apps/mobile/src/components/chat/topic-sheets-roles.test.tsx:1-140`, `apps/mobile/src/components/ui/bottom-sheet.tsx`, `apps/mobile/src/app/chat/[id].tsx:165-175`, `:460-480` and `:990-1040`.

### Allowed files
`apps/mobile/src/components/ais/ai-memory-section.tsx`, `apps/mobile/src/components/ais/ai-memory-section.test.tsx`, `apps/mobile/src/components/ais/ai-memory-sheet.tsx`, `apps/mobile/src/components/ais/ai-memory-sheet.test.tsx`, `apps/mobile/src/components/chat/topic-sheets.tsx`, `apps/mobile/src/components/chat/topic-sheets-memory.test.tsx`, `apps/mobile/src/app/chat/[id].tsx`, `work/T-0451-mobile-ai-memory-rooms.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot ai-memory topic-sheets
pnpm gate
```

### Acceptance
- In a topic's info sheet, each AI opens a "What <AI> remembers" sheet for that room. Forget and Clear show only when the server allows them.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
