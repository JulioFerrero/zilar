import type { Machine } from '@zilar/api-contract';
import type { MockSeed } from '../../data';
import type { MockData } from '../../state';

/**
 * The owner's machines and their mutators. Rows are cloned from the seed, so a
 * caller-supplied seed is never changed; revoking also detaches the machine's
 * AIs, which the AI domain owns (`MockData.detachMachine`).
 */
export function createMachinesState(seed: MockSeed): Partial<MockData> {
  let machines: Machine[] = seed.machines.map((machine) => ({ ...machine }));
  return {
    get machines(): readonly Machine[] {
      return machines;
    },
    findMachine(id: string): Machine | undefined {
      return machines.find((machine) => machine.id === id);
    },
    putMachine(machine: Machine): Machine {
      const exists = machines.some((item) => item.id === machine.id);
      machines = exists
        ? machines.map((item) => (item.id === machine.id ? machine : item))
        : [...machines, machine];
      return machine;
    },
    removeMachine(id: string): void {
      machines = machines.filter((machine) => machine.id !== id);
    },
  };
}
