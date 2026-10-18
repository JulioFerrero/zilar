// effect-plain: Promise port over the contract; each app's `call` owns the Effect edge.
// The shared AI and connection calls: web and phone each supply the transport.
import type { Effect } from 'effect';
import {
  ApiError,
  isProviderId,
  type AiCatalog,
  type AiComputerOptions,
  type AiLimits,
  type AiTemplate,
  type ConnectionView,
  type PublicAi as ContractAi,
  type ZilarClient,
} from '@zilar/api-contract';

export type {
  AiCatalog,
  AiComputerOptions,
  AiLimits,
  AiTemplate,
  AiUsage,
} from '@zilar/api-contract';

export type PublicAi = { -readonly [K in keyof ContractAi]: ContractAi[K] };

export type Connection = ConnectionView;

export interface CreateAiInput {
  name: string;
  template: AiTemplate;
  persona?: string;
  providerConnectionId: string;
  model: string;
  limits: AiLimits;
}

export interface UpdateAiInput {
  name?: string;
  persona?: string;
  limits?: AiLimits;
  model?: string;
  providerConnectionId?: string;
  // The owner's delegation opt-ins.
  canDelegate?: boolean;
  acceptsDelegation?: boolean;
  // Where the AI's computer runs.
  computerMode?: 'off' | 'cloud' | 'runner' | 'auto';
}

export interface CreateConnectionInput {
  provider: string;
  key: string;
  label?: string;
  /** Required for openai-compatible, refused for every other provider. */
  baseUrl?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  message?: string;
}

type AisCall = <A, E>(call: (client: ZilarClient) => Effect.Effect<A, E>) => Promise<A>;

/**
 * The AI and connection API of both apps, over the caller's `call`. The contract encodes
 * the trimmed form the server checks, so create and update trim before sending;
 * `createConnection` refuses an unknown provider before the request leaves.
 */
export function makeAisApi(call: AisCall) {
  return {
    listAis: (): Promise<PublicAi[]> => call((c) => c.ais.list()).then((rows) => [...rows]),

    getAi: (id: string): Promise<PublicAi> => call((c) => c.ais.detail({ params: { id } })),

    getAiCatalog: (): Promise<AiCatalog> => call((c) => c.ais.catalog()),

    getComputerOptions: (): Promise<AiComputerOptions> => call((c) => c.ais.computerOptions()),

    createAi: (input: CreateAiInput): Promise<PublicAi> =>
      call((c) =>
        c.ais.create({
          payload: {
            name: input.name.trim(),
            template: input.template,
            ...(input.persona === undefined ? {} : { persona: input.persona.trim() }),
            providerConnectionId: input.providerConnectionId.trim(),
            model: input.model.trim(),
            limits: input.limits,
          },
        }),
      ),

    updateAi: (id: string, input: UpdateAiInput): Promise<PublicAi> =>
      call((c) =>
        c.ais.patch({
          params: { id },
          payload: {
            ...(input.name === undefined ? {} : { name: input.name.trim() }),
            ...(input.persona === undefined ? {} : { persona: input.persona.trim() }),
            ...(input.limits === undefined ? {} : { limits: input.limits }),
            ...(input.model === undefined ? {} : { model: input.model.trim() }),
            ...(input.providerConnectionId === undefined
              ? {}
              : { providerConnectionId: input.providerConnectionId.trim() }),
            ...(input.canDelegate === undefined ? {} : { canDelegate: input.canDelegate }),
            ...(input.acceptsDelegation === undefined
              ? {}
              : { acceptsDelegation: input.acceptsDelegation }),
            ...(input.computerMode === undefined ? {} : { computerMode: input.computerMode }),
          },
        }),
      ),

    deleteAi: (id: string): Promise<void> =>
      call((c) => c.ais.remove({ params: { id } })).then(() => undefined),

    // Both return the fresh public AI so the panel re-renders without a second GET; the
    // not_active 409 when the AI was already terminal is a refresh cue.
    stopAi: (id: string): Promise<PublicAi> => call((c) => c.ais.stop({ params: { id } })),

    resumeAi: (id: string): Promise<PublicAi> => call((c) => c.ais.resume({ params: { id } })),

    // Stops the turn running in one chat, not the AI kill switch.
    stopAiTurn: (id: string, chatJid: string): Promise<{ stopped: boolean }> =>
      call((c) => c.ais.stopTurn({ params: { id }, payload: { chatJid: chatJid.trim() } })),

    // null clears the machine assignment: the AI runs on the platform.
    setAiMachine: (aiId: string, machineId: string | null): Promise<PublicAi> =>
      call((c) =>
        c.ais.assignMachine({
          params: { id: aiId },
          payload: { machineId: machineId === null ? null : machineId.trim() },
        }),
      ),

    listConnections: (): Promise<Connection[]> =>
      call((c) => c.connections.list()).then((rows) => [...rows]),

    createConnection: (input: CreateConnectionInput): Promise<Connection> => {
      const { provider } = input;
      if (!isProviderId(provider)) {
        return Promise.reject(new ApiError(400, 'invalid_request', 'Invalid connection request'));
      }
      // The server trims the key and the label; the contract encodes the trimmed form.
      return call((c) =>
        c.connections.create({
          payload: {
            provider,
            key: input.key.trim(),
            ...(input.label === undefined ? {} : { label: input.label.trim() }),
            ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl.trim() }),
          },
        }),
      );
    },

    testConnection: (id: string): Promise<ConnectionTestResult> =>
      call((c) => c.connections.test({ params: { id } })),

    deleteConnection: (id: string): Promise<void> =>
      call((c) => c.connections.remove({ params: { id } })).then(() => undefined),

    // Replaces the key in place, so AIs using it keep working; the next turn decrypts the new key.
    replaceConnectionKey: (id: string, key: string): Promise<Connection> =>
      call((c) => c.connections.update({ params: { id }, payload: { key: key.trim() } })),
  };
}
