import { ApiError, runApi, type PublicAi as ContractAi } from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

/**
 * The AI management API (`/api/ais`), the mobile twin of the web client in
 * `apps/web/src/lib/api.ts`. A Promise port over the client derived from the
 * shared contract (`@zilar/api-contract`, `ais.ts`, T-0893).
 * `AisApiError` is the shared `ApiError`, which keeps the server's `code` and
 * `status`, so screens can branch on the error without parsing the message
 * again.
 */

export type AiTemplate = 'dev' | 'marketing' | 'fun' | 'custom';

export interface AiLimits {
  perDayUsd: number;
  perMonthUsd: number;
}

export interface PublicAi {
  id: string;
  name: string;
  template: AiTemplate;
  persona: string;
  model: string;
  jid: string;
  // `stopped` is the owner kill switch (T-0080). Mobile only renders the
  // AI list, so accepting it in the type guard keeps the list rendering
  // for a paused AI — the screen shows it as "stopped" rather than failing.
  status: 'active' | 'disabled' | 'stopped';
  providerConnectionId: string;
  limits: AiLimits;
  // T-0091: the AI's home machine id, or null when it runs on the
  // platform. Optional so older payloads stay valid; a missing or non-string
  // value maps to null. CamelCase like the rest of the public AI fields.
  machineId?: string | null | undefined;
  createdAt: string;
}

export interface Connection {
  id: string;
  provider: string;
  label: string | null;
  status: string;
  createdAt: string;
}

export interface CreateAiInput {
  name: string;
  template: AiTemplate;
  /** Omit for a stock template the user did not edit: the server applies its default. */
  persona?: string;
  providerConnectionId: string;
  model: string;
  limits: AiLimits;
}

/** PATCH carries only the fields that actually changed. */
export interface UpdateAiInput {
  name?: string;
  persona?: string;
  limits?: AiLimits;
}

export interface AisApi {
  listAis(): Promise<PublicAi[]>;
  createAi(input: CreateAiInput): Promise<PublicAi>;
  updateAi(id: string, input: UpdateAiInput): Promise<PublicAi>;
  deleteAi(id: string): Promise<void>;
  listConnections(): Promise<Connection[]>;
  // T-0080: the owner kill switch. The server answers the fresh public AI so
  // the list can swap the row against server truth without a second GET.
  stopAi(id: string): Promise<PublicAi>;
  resumeAi(id: string): Promise<PublicAi>;
}

/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const AisApiError = ApiError;
export type AisApiError = ApiError;

/** The exact POST body the server's strict create decode accepts. */
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

// Only the fields this app renders; the usage, avatar and delegation fields
// of the wire payload are for the web. A missing `machineId` reads as `null`.
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
    machineId: ai.machineId ?? null,
    createdAt: ai.createdAt,
  };
}

/** The production `AisApi`: bearer auth, `fetch`, and the build-time API URL. */
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
      // The server trims these strings; the contract encodes the trimmed form.
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
    async stopAi(id) {
      return toPublicAi(await runApi(client.ais.stop({ params: { id } })));
    },
    async resumeAi(id) {
      return toPublicAi(await runApi(client.ais.resume({ params: { id } })));
    },
  };
}
