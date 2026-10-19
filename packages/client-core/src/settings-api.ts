// effect-plain: Promise port over the contract; each app's `call` owns the Effect edge.
import { Result, Schema, type Effect } from 'effect';
import {
  ApiError,
  omitUndefined,
  type BlocksRespondPayload,
  type PublicAuditEntry,
  type ZilarClient,
} from '@zilar/api-contract';
import { BlocksDataSchema, type BlocksData } from '@zilar/protocol';

type SettingsCall = <A, E>(call: (client: ZilarClient) => Effect.Effect<A, E>) => Promise<A>;

export type SaveEmailSettingsInput = { from: string; resendApiKey?: string | undefined };

export interface SaveVoiceTranscriptionInput {
  baseUrl: string;
  apiKey?: string | undefined;
  model?: string | undefined;
}

// Exactly one of ?aiId= or ?groupId= is required; the union makes both or neither a compile error.
export type AuditScope =
  { aiId: string; groupId?: undefined } | { groupId: string; aiId?: undefined };
export type ListAuditInput = AuditScope & { limit?: number; before?: string };
export type ListAuditPage = { entries: PublicAuditEntry[]; next: string | null };

export const AUDIT_PAGE_LIMIT = 20;

/** The integrations and voice-transcription calls; secrets are write-only and trimmed here. */
export function makeIntegrationsApi(call: SettingsCall) {
  const done = <E>(request: (client: ZilarClient) => Effect.Effect<unknown, E>): Promise<void> =>
    call(request).then(() => undefined);
  return {
    getIntegrationsStatus: () => call((c) => c.integrations.status()),
    saveTelegramBotToken: (botToken: string) =>
      done((c) => c.integrations.setTelegram({ payload: { botToken: botToken.trim() } })),
    removeTelegramBotToken: () => done((c) => c.integrations.removeTelegram()),
    saveEmailSettings: (input: SaveEmailSettingsInput) =>
      done((c) =>
        c.integrations.setEmail({
          payload: omitUndefined({
            from: input.from.trim(),
            resendApiKey: input.resendApiKey?.trim(),
          }),
        }),
      ),
    getVoiceTranscriptionStatus: () => call((c) => c.voiceTranscription.status()),
    getVoiceTranscript: (url: string) =>
      call((c) => c.voiceTranscription.transcript({ payload: { url } })),
    saveVoiceTranscriptionSettings: (input: SaveVoiceTranscriptionInput) =>
      done((c) =>
        c.voiceTranscription.setSettings({
          payload: omitUndefined({
            baseUrl: input.baseUrl,
            apiKey: input.apiKey,
            model: input.model,
          }),
        }),
      ),
    removeVoiceTranscriptionSettings: () => done((c) => c.voiceTranscription.removeSettings()),
  };
}

/** The machines calls; `rename` sends the trimmed name the contract encodes. */
export function makeMachinesApi(call: SettingsCall) {
  const done = <E>(request: (client: ZilarClient) => Effect.Effect<unknown, E>): Promise<void> =>
    call(request).then(() => undefined);
  return {
    listMachines: () => call((c) => c.machines.list()).then((rows) => [...rows]),
    createPairingCode: () => call((c) => c.machines.createPairingCode()),
    approveMachine: (id: string) => call((c) => c.machines.approve({ params: { id } })),
    denyMachine: (id: string) => done((c) => c.machines.deny({ params: { id } })),
    revokeMachine: (id: string) => call((c) => c.machines.revoke({ params: { id } })),
    renameMachine: (id: string, name: string) =>
      call((c) => c.machines.rename({ params: { id }, payload: { name: name.trim() } })),
    deleteMachine: (id: string) => done((c) => c.machines.remove({ params: { id } })),
  };
}

export function makeAuditApi(call: SettingsCall) {
  const page = (input: ListAuditInput): Promise<ListAuditPage> => {
    const query = omitUndefined({
      aiId: input.aiId,
      groupId: input.groupId,
      limit: input.limit,
      before: input.before === '' ? undefined : input.before,
    });
    return call((c) => c.audit.list({ query })).then((body) => ({
      entries: [...body.entries],
      next: body.next,
    }));
  };
  const scoped = (scope: AuditScope, before?: string): Promise<ListAuditPage> =>
    page({ ...scope, limit: AUDIT_PAGE_LIMIT, ...(before ? { before } : {}) });
  return {
    listAudit: page,
    listAiAudit: (aiId: string, before?: string) => scoped({ aiId }, before),
    listGroupAudit: (groupId: string, before?: string) => scoped({ groupId }, before),
  };
}

/** The card comes back as opaque data; a failed decode rejects as `invalid_response`. */
export function makeBlocksApi(call: SettingsCall) {
  return {
    respondToBlock: (payload: BlocksRespondPayload): Promise<BlocksData> =>
      call((c) => c['message-blocks'].respond({ payload })).then(({ data }) => {
        const decoded = Schema.decodeUnknownResult(BlocksDataSchema)(data);
        if (Result.isFailure(decoded)) {
          throw new ApiError(200, 'invalid_response', 'The server sent an unexpected response');
        }
        return decoded.success;
      }),
    myBlockPicks: (messageId: string): Promise<Record<string, readonly string[]>> =>
      call((c) => c['message-blocks'].mine({ query: { messageId } })).then(({ picks }) => picks),
  };
}

export type IntegrationsApi = ReturnType<typeof makeIntegrationsApi>;
export type MachinesApi = ReturnType<typeof makeMachinesApi>;
export type AuditApi = ReturnType<typeof makeAuditApi>;
