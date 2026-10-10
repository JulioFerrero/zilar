import type { MockData } from '../../state';
import { seedAiMemory, type MockAiMemory } from './seed';

/**
 * The AI-memory table, one row per chat+ai key, seeded lazily on first read like
 * web's mock. Every write replaces the row, so a `reset()` starts clean.
 */
export function createAiMemoryState(): Partial<MockData> {
  const memory = new Map<string, MockAiMemory>();
  function aiMemoryFor(key: string): MockAiMemory {
    const existing = memory.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const seeded = seedAiMemory();
    memory.set(key, seeded);
    return seeded;
  }
  function removeAiFact(key: string, factId: string): boolean {
    const row = aiMemoryFor(key);
    if (!row.facts.some((fact) => fact.id === factId)) {
      return false;
    }
    memory.set(key, { ...row, facts: row.facts.filter((fact) => fact.id !== factId) });
    return true;
  }
  function clearAiMemory(key: string): void {
    memory.set(key, { facts: [], lines: [] });
  }
  return { aiMemoryFor, removeAiFact, clearAiMemory };
}
