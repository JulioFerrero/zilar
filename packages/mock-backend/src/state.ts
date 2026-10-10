import type { ChatEntry, ConnectionView, Machine, PublicAi } from '@zilar/api-contract';
import type { MockAiMemory, MockMe, MockMessage, MockPerson, MockSeed } from './data';
import { seedAiMemory } from './data/ais';

/**
 * The live, in-memory tables and their mutators. One per `MockBackend`.
 *
 * The AI/connection/machine tables (T-0940) are owned here so the four AI
 * routes only validate and shape the request; every array is replaced, never
 * mutated in place, so a `reset()` cannot leak a previous seed.
 */
export interface MockData {
  readonly me: MockMe;
  readonly people: readonly MockPerson[];
  readonly chats: readonly ChatEntry[];
  readonly messages: Readonly<Record<string, readonly MockMessage[]>>;
  readonly ais: readonly PublicAi[];
  readonly connections: readonly ConnectionView[];
  readonly machines: readonly Machine[];
  /** Rename the viewer (`PATCH /me`); the only mutator task A needs. */
  renameMe(name: string): void;

  findAi(id: string): PublicAi | undefined;
  /** The next `ai-mock-N` id, matching web's `nextAiSequence`. */
  nextAiId(): string;
  /** Replace an AI in place, or prepend it when it is new (like web's create). */
  putAi(ai: PublicAi): void;
  removeAi(id: string): void;

  hasConnection(id: string): boolean;
  /** The next `conn-mock-N` id, matching web's `nextConnectionSequence`. */
  nextConnectionId(): string;
  /** Prepend a new connection, or replace the row with the same id. */
  putConnection(connection: ConnectionView): void;
  removeConnection(id: string): void;

  findMachine(id: string): Machine | undefined;
  /** Replace a machine in place, or append it when it is new. */
  putMachine(machine: Machine): Machine;
  removeMachine(id: string): void;
  /** Clears the home-machine link of every AI on a machine (revoke). */
  detachMachine(machineId: string): void;

  /** The memory for a chat+ai key, seeded on first read like web's mock. */
  aiMemoryFor(key: string): MockAiMemory;
  removeAiFact(key: string, factId: string): boolean;
  clearAiMemory(key: string): void;
}

function cloneAi(ai: PublicAi): PublicAi {
  return { ...ai, limits: { ...ai.limits } };
}

export function createMockData(seed: MockSeed): MockData {
  let me = { ...seed.me };
  let ais: PublicAi[] = seed.ais.map(cloneAi);
  let connections: ConnectionView[] = seed.connections.map((connection) => ({ ...connection }));
  let machines: Machine[] = seed.machines.map((machine) => ({ ...machine }));
  const aiMemory = new Map<string, MockAiMemory>();
  let aiSequence = 1;
  let connectionSequence = 1;

  return {
    get me(): MockMe {
      return me;
    },
    people: seed.people,
    chats: seed.chats,
    messages: seed.messages,
    get ais(): readonly PublicAi[] {
      return ais;
    },
    get connections(): readonly ConnectionView[] {
      return connections;
    },
    get machines(): readonly Machine[] {
      return machines;
    },
    renameMe(name: string): void {
      me = { ...me, name };
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

    hasConnection(id: string): boolean {
      return connections.some((connection) => connection.id === id);
    },
    nextConnectionId(): string {
      const id = `conn-mock-${connectionSequence}`;
      connectionSequence += 1;
      return id;
    },
    putConnection(connection: ConnectionView): void {
      const exists = connections.some((item) => item.id === connection.id);
      connections = exists
        ? connections.map((item) => (item.id === connection.id ? connection : item))
        : [connection, ...connections];
    },
    removeConnection(id: string): void {
      connections = connections.filter((connection) => connection.id !== id);
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
    detachMachine(machineId: string): void {
      ais = ais.map((ai) => (ai.machineId === machineId ? { ...ai, machineId: null } : ai));
    },

    aiMemoryFor(key: string): MockAiMemory {
      const existing = aiMemory.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const seeded = seedAiMemory();
      aiMemory.set(key, seeded);
      return seeded;
    },
    removeAiFact(key: string, factId: string): boolean {
      const memory = this.aiMemoryFor(key);
      if (!memory.facts.some((fact) => fact.id === factId)) {
        return false;
      }
      aiMemory.set(key, {
        ...memory,
        facts: memory.facts.filter((fact) => fact.id !== factId),
      });
      return true;
    },
    clearAiMemory(key: string): void {
      aiMemory.set(key, { facts: [], lines: [] });
    },
  };
}
