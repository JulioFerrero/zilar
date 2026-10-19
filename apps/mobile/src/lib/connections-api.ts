import type { Connection, ConnectionTestResult, CreateConnectionInput } from '@zilar/client-core';

/**
 * An API key is write-only: the server never returns one, this module never stores one, and it travels only in the POST body of `createConnection`. Never log a request body: it carries the provider key.
 */

export type ProviderConnection = Connection;

export type { ConnectionTestResult, CreateConnectionInput } from '@zilar/client-core';

export interface ConnectionsApi {
  listConnections(): Promise<ProviderConnection[]>;
  createConnection(input: CreateConnectionInput): Promise<ProviderConnection>;
  testConnection(id: string): Promise<ConnectionTestResult>;
  replaceConnectionKey(id: string, key: string): Promise<ProviderConnection>;
  deleteConnection(id: string): Promise<void>;
}
