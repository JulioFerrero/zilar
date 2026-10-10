// The AI memory one chat+AI key starts with (T-0940); the route adds `canChange`.
import type { AiMemoryFact } from '@zilar/api-contract';

export interface MockAiMemory {
  readonly facts: readonly AiMemoryFact[];
  readonly lines: readonly string[];
}

/** The memory a chat+AI key starts with (two facts, three cover lines). */
export function seedAiMemory(): MockAiMemory {
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
  };
}
