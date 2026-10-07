import type { AiMemory, AiMemoryApi } from '../lib/ai-memory-api';

/**
 * Mock AI memory for the AI edit screen (T-0449), the mobile twin of the web
 * seed in `apps/web/src/mock/api.ts` (`seedAiMemory`): two pinned facts and
 * three cover lines (one summary, two messages). `createMockAiMemoryApi`
 * keeps its own copy in memory, so Forget and Clear behave like the server.
 */
function seedMemory(): AiMemory {
  return {
    facts: [
      { id: 'fact-1', text: 'Julio prefers short answers.' },
      { id: 'fact-2', text: 'The launch is on Friday.' },
    ],
    lines: [
      '#0-15 Summary: the team agreed on the launch plan and pricing.',
      '#16 2026-10-01 Julio: Let us keep the pricing simple.',
      '#17 2026-10-01 Dev-1: Agreed, two tiers only.',
    ],
    canChange: true,
  };
}

/** An `AiMemoryApi` backed by the seeded memory, for offline UI work. */
export function createMockAiMemoryApi(): AiMemoryApi {
  let memory = seedMemory();
  return {
    async getMemory(_chat, _aiId) {
      return { facts: [...memory.facts], lines: [...memory.lines], canChange: memory.canChange };
    },
    async forgetFact(_chat, _aiId, factId) {
      memory = { ...memory, facts: memory.facts.filter((fact) => fact.id !== factId) };
    },
    async clear(_chat, _aiId) {
      memory = { ...memory, facts: [], lines: [] };
    },
  };
}
