import { ApiError, isProviderId, runApi } from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

/**
 * The model provider connections API (`/api/connections`), the mobile twin
 * of the web client in `apps/web/src/lib/api.ts`. A Promise port over the
 * client derived from the shared contract (`@zilar/api-contract`,
 * `connections.ts`, T-0893).
 *
 * An API key is write-only: the server never returns one, and this module
 * never stores one. The key travels only in the POST body of
 * `createConnection` and is dropped by the caller right after.
 *
 * `ConnectionsApiError` is the shared `ApiError`, which keeps the server's
 * `code` and `status`, so screens can branch on the error without parsing the
 * message again. Never log a request body: it carries the provider key.
 */

export interface ProviderConnection {
  id: string;
  provider: string;
  label: string | null;
  status: string;
  createdAt: string;
}

export interface CreateConnectionInput {
  provider: string;
  key: string;
  label?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  message?: string;
}

export interface ConnectionsApi {
  listConnections(): Promise<ProviderConnection[]>;
  createConnection(input: CreateConnectionInput): Promise<ProviderConnection>;
  testConnection(id: string): Promise<ConnectionTestResult>;
  deleteConnection(id: string): Promise<void>;
}

/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const ConnectionsApiError = ApiError;
export type ConnectionsApiError = ApiError;

/** The exact POST body the server's strict create decode accepts. */
export function buildCreateConnectionBody(input: CreateConnectionInput): Record<string, unknown> {
  return {
    provider: input.provider,
    key: input.key,
    ...(input.label === undefined ? {} : { label: input.label }),
  };
}

/** The production `ConnectionsApi`: bearer auth, `fetch`, and the build-time API URL. */
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
      // The server trims the key and the label; the contract encodes the trimmed form.
      return runApi(
        client.connections.create({
          payload: {
            provider,
            key: input.key.trim(),
            ...(input.label === undefined ? {} : { label: input.label.trim() }),
          },
        }),
      );
    },
    testConnection(id) {
      return runApi(client.connections.test({ params: { id } }));
    },
    async deleteConnection(id) {
      await runApi(client.connections.remove({ params: { id } }));
    },
  };
}
