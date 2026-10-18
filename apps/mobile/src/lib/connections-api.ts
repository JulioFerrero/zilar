import { ApiError, isProviderId, runApi } from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

/**
 * An API key is write-only: the server never returns one, this module never stores one, and it travels only in the POST body of `createConnection`. Never log a request body: it carries the provider key.
 */

export interface ProviderConnection {
  id: string;
  provider: string;
  label: string | null;
  baseUrl: string | null;
  status: string;
  createdAt: string;
}

export interface CreateConnectionInput {
  provider: string;
  key: string;
  label?: string;
  baseUrl?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  message?: string;
}

export interface ConnectionsApi {
  listConnections(): Promise<ProviderConnection[]>;
  createConnection(input: CreateConnectionInput): Promise<ProviderConnection>;
  testConnection(id: string): Promise<ConnectionTestResult>;
  replaceConnectionKey(id: string, key: string): Promise<ProviderConnection>;
  deleteConnection(id: string): Promise<void>;
}

export const ConnectionsApiError = ApiError;
export type ConnectionsApiError = ApiError;

export function buildCreateConnectionBody(input: CreateConnectionInput): Record<string, unknown> {
  return {
    provider: input.provider,
    key: input.key,
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
  };
}

export function createConnectionsApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ConnectionsApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return {
    async listConnections() {
      const rows = await runApi(client.connections.list());
      return [...rows];
    },
    createConnection(input) {
      const { provider } = input;
      if (!isProviderId(provider)) {
        return Promise.reject(new ApiError(400, 'invalid_request', 'Invalid connection request'));
      }
      return runApi(
        client.connections.create({
          payload: {
            provider,
            key: input.key.trim(),
            ...(input.label === undefined ? {} : { label: input.label.trim() }),
            ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl.trim() }),
          },
        }),
      );
    },
    testConnection(id) {
      return runApi(client.connections.test({ params: { id } }));
    },
    // Replacing the key keeps the AIs using the connection working; the next turn decrypts the new key.
    replaceConnectionKey(id, key) {
      return runApi(client.connections.update({ params: { id }, payload: { key: key.trim() } }));
    },
    async deleteConnection(id) {
      await runApi(client.connections.remove({ params: { id } }));
    },
  };
}
