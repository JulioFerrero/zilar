import type { PublicAi } from '@zilar/api-contract';
import type { MockSeed } from '../../data';
import type { MockData } from '../../state';

function cloneAi(ai: PublicAi): PublicAi {
  return { ...ai, limits: { ...ai.limits } };
}

/**
 * The owner's AIs and their mutators. Every array is replaced, never mutated in
 * place, so a `reset()` cannot leak a previous seed. `detachMachine` lives here
 * because revoking a machine clears the home-machine link of its AIs (the
 * machines route calls it).
 */
export function createAisState(seed: MockSeed): Partial<MockData> {
  let ais: PublicAi[] = seed.ais.map(cloneAi);
  let aiSequence = 1;
  return {
    get ais(): readonly PublicAi[] {
      return ais;
    },
    findAi(id: string): PublicAi | undefined {
      return ais.find((ai) => ai.id === id);
    },
    nextAiId(): string {
      const id = `ai-mock-${aiSequence}`;
      aiSequence += 1;
      return id;
    },
    putAi(ai: PublicAi): void {
      const exists = ais.some((item) => item.id === ai.id);
      ais = exists ? ais.map((item) => (item.id === ai.id ? ai : item)) : [ai, ...ais];
    },
    removeAi(id: string): void {
      ais = ais.filter((ai) => ai.id !== id);
    },
    detachMachine(machineId: string): void {
      ais = ais.map((ai) => (ai.machineId === machineId ? { ...ai, machineId: null } : ai));
    },
  };
}
