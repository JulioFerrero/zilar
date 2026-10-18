import { runApi } from '@zilar/api-contract';
import {
  makeAisApi,
  type Connection,
  type ConnectionTestResult,
  type CreateConnectionInput,
} from '@zilar/client-core';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

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

export function createConnectionsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ConnectionsApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return makeAisApi((call) => runApi(call(client)));
}
