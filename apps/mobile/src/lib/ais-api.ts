import {
  ApiError,
  runApi,
  type AiCatalog,
  type AiComputerOptions,
  type PublicAi as ContractAi,
} from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

/**
 * `AisApiError` is the shared `ApiError`, so screens branch on `status` without parsing the message.
 */

export type AiTemplate = 'dev' | 'marketing' | 'fun' | 'custom';

export interface AiLimits {
  perDayUsd: number | null;
  perMonthUsd: number | null;
}

export interface PublicAi {
  id: string;
  name: string;
  template: AiTemplate;
  persona: string;
  model: string;
  jid: string;
  // Accepting `stopped` in the type guard keeps the list rendering for a paused AI, shown as "stopped" rather than failing.
  status: 'active' | 'disabled' | 'stopped';
  providerConnectionId: string;
  limits: AiLimits;
  /**
   * Optional so an older server's payload stays valid.
   */
  usage?: { todayUsd: number; windowUsd: number } | null | undefined;
  /**
   * Optional so an older server's payload stays valid.
   */
  lastFailure?: { kind: string; at: string } | null | undefined;
  // Optional so older payloads stay valid; a missing or non-string value maps to null.
  machineId?: string | null | undefined;
  avatarUrl?: string | undefined;
  /**
   * `off` is the default; optional so an older payload stays valid.
   */
  computerMode?: 'off' | 'cloud' | 'runner' | 'auto' | undefined;
  createdAt: string;
}

export interface Connection {
  id: string;
  provider: string;
  label: string | null;
  baseUrl: string | null;
  status: string;
  createdAt: string;
}

export interface CreateAiInput {
  name: string;
  template: AiTemplate;
  /** A stock template the user did not edit: the server applies its default. */
  persona?: string;
  providerConnectionId: string;
  model: string;
  limits: AiLimits;
}

export interface UpdateAiInput {
  name?: string;
  persona?: string;
  limits?: AiLimits;
  computerMode?: 'off' | 'cloud' | 'runner' | 'auto';
}

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

export const AisApiError = ApiError;
export type AisApiError = ApiError;

export function buildCreateBody(input: CreateAiInput): Record<string, unknown> {
  return {
    name: input.name,
    template: input.template,
    ...(input.persona === undefined ? {} : { persona: input.persona }),
    providerConnectionId: input.providerConnectionId,
    model: input.model,
    limits: input.limits,
  };
}

// A missing `machineId`, `usage` or `lastFailure` (an older server) reads as `null`.
function toPublicAi(ai: ContractAi): PublicAi {
  return {
    id: ai.id,
    name: ai.name,
    template: ai.template,
    persona: ai.persona,
    model: ai.model,
    jid: ai.jid,
    status: ai.status,
    providerConnectionId: ai.providerConnectionId,
    limits: { perDayUsd: ai.limits.perDayUsd, perMonthUsd: ai.limits.perMonthUsd },
    usage: ai.usage ?? null,
    lastFailure: ai.lastFailure ?? null,
    machineId: ai.machineId ?? null,
    computerMode: ai.computerMode ?? 'off',
    ...(ai.avatarUrl === undefined ? {} : { avatarUrl: ai.avatarUrl }),
    createdAt: ai.createdAt,
  };
}

export function createAisApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): AisApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return {
    async listAis() {
      const rows = await runApi(client.ais.list());
      return rows.map(toPublicAi);
    },
    async createAi(input) {
      const created = await runApi(
        client.ais.create({
          payload: {
            name: input.name.trim(),
            template: input.template,
            ...(input.persona === undefined ? {} : { persona: input.persona.trim() }),
            providerConnectionId: input.providerConnectionId.trim(),
            model: input.model.trim(),
            limits: input.limits,
          },
        }),
      );
      return toPublicAi(created);
    },
    async updateAi(id, input) {
      const updated = await runApi(
        client.ais.patch({
          params: { id },
          payload: {
            ...(input.name === undefined ? {} : { name: input.name.trim() }),
            ...(input.persona === undefined ? {} : { persona: input.persona.trim() }),
            ...(input.limits === undefined ? {} : { limits: input.limits }),
            ...(input.computerMode === undefined ? {} : { computerMode: input.computerMode }),
          },
        }),
      );
      return toPublicAi(updated);
    },
    async deleteAi(id) {
      await runApi(client.ais.remove({ params: { id } }));
    },
    async listConnections() {
      const rows = await runApi(client.connections.list());
      return [...rows];
    },
    async getAiCatalog() {
      return runApi(client.ais.catalog());
    },
    async getComputerOptions() {
      return runApi(client.ais.computerOptions());
    },
    async stopAi(id) {
      return toPublicAi(await runApi(client.ais.stop({ params: { id } })));
    },
    async resumeAi(id) {
      return toPublicAi(await runApi(client.ais.resume({ params: { id } })));
    },
    async stopAiTurn(id, chatJid) {
      return runApi(client.ais.stopTurn({ params: { id }, payload: { chatJid: chatJid.trim() } }));
    },
  };
}
