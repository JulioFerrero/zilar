import type { ConnectionView } from '@zilar/api-contract';
import type { MockSeed } from '../../data';
import type { MockData } from '../../state';

/**
 * The provider-connection table and its mutators. Rows are cloned from the seed
 * so a caller-supplied seed is never changed, and the id sequence minting
 * `conn-mock-N` matches web's mock.
 */
export function createConnectionsState(seed: MockSeed): Partial<MockData> {
  let connections: ConnectionView[] = seed.connections.map((connection) => ({ ...connection }));
  let connectionSequence = 1;
  return {
    get connections(): readonly ConnectionView[] {
      return connections;
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
  };
}
