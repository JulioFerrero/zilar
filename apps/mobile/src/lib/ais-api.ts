import { runApi, type AiCatalog, type AiComputerOptions } from '@zilar/api-contract';
import {
  makeAisApi,
  type Connection,
  type CreateAiInput,
  type PublicAi,
  type UpdateAiInput,
} from '@zilar/client-core';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

/**
 * Errors are the shared `ApiError`, so screens branch on `status` without parsing the message.
 */

export type {
  AiLimits,
  AiTemplate,
  Connection,
  CreateAiInput,
  PublicAi,
  UpdateAiInput,
} from '@zilar/client-core';

export interface AisApi {
  listAis(): Promise<PublicAi[]>;
  createAi(input: CreateAiInput): Promise<PublicAi>;
  updateAi(id: string, input: UpdateAiInput): Promise<PublicAi>;
  deleteAi(id: string): Promise<void>;
  listConnections(): Promise<Connection[]>;
  getAiCatalog(): Promise<AiCatalog>;
  getComputerOptions(): Promise<AiComputerOptions>;
  // The server answers the fresh public AI, so the list can swap the row against server truth without a second GET.
  stopAi(id: string): Promise<PublicAi>;
  resumeAi(id: string): Promise<PublicAi>;
  stopAiTurn(id: string, chatJid: string): Promise<{ stopped: boolean }>;
}

export function createAisApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): AisApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return makeAisApi((call) => runApi(call(client)));
}
