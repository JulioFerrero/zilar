// The database helpers the gateway (M3) and the routes (M4) call for one AI's
// long-term memory (T-0438, docs/audit/ai-memory-plan.md §3.3-§3.7). Every
// function is scoped to one (AI, chat) pair and never logs text. The pure tree
// logic lives in `./tree.ts`.
//
// T-1025 split the old body into `mirror.ts` (the (AI, chat) range and the raw
// reads), `render.ts` (the system-prompt block), `recall.ts` (keyword and zoom
// recall), `facts.ts` (pinned facts), `compaction.ts` (the compaction feed and
// node store) and `state.ts` (the room delete and "clear memory"). This path
// stays a thin barrel so every importer keeps working with the same names and
// kinds.
export { MEMORY_FACTS_MAX } from './facts';
export type { AddFactResult, MemoryFact } from './facts';
export { addFact, deleteFact, listFacts } from './facts';

export { MEMORY_RECALL_MAX } from './recall';
export { recallMemory, zoomMemory } from './recall';

export { MEMORY_WINDOW } from './mirror';
export type { MemoryRange } from './mirror';
export { memoryRange } from './mirror';

export { renderMemoryBlock } from './render';

export { buildCompactionPrompt, compactionInput, pendingNodes, putNode } from './compaction';

export { clearMemory, deleteRoomMemoryEffect } from './state';
