// AI management (T-0032): create, edit, stop and resume an AI, assign it a
// home machine, and read the owner's AIs with their spend summary.
//
// The write routes (create, patch, stop, resume, machine) answer the plain
// public AI; the list and detail routes add the `usage` summary. One schema
// serves both: `usage` is optional, and null means "unavailable".

import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { LenientOptionalNullableString } from './lenient-nullable-string';
import { AisConfigured, AisSchemaErrors, Session } from './middleware';

export const AI_TEMPLATES = ['dev', 'marketing', 'fun', 'custom'] as const;

export const AiTemplate = Schema.Literals(AI_TEMPLATES);

export type AiTemplate = typeof AiTemplate.Type;

// T-1409: where an AI's computer (desk) runs. `off` is the default and means
// none; `cloud` is Zilar cloud, `runner` the owner's machine and `auto` the
// owner's machine when it is online, else cloud.
export const AI_COMPUTER_MODES = ['off', 'cloud', 'runner', 'auto'] as const;

export const AiComputerMode = Schema.Literals(AI_COMPUTER_MODES);

export type AiComputerMode = typeof AiComputerMode.Type;

// T-1425: what the Computer picker may offer. `cloud` is true when the server
// has the cloud desk client wired; when it is false the picker disables the
// cloud option with "Not available yet".
export const AiComputerOptions = Schema.Struct({
  cloud: Schema.Boolean,
});

export type AiComputerOptions = typeof AiComputerOptions.Type;

/** The server ceiling for an AI's monthly spend limit. */
export const MAX_MONTHLY_USD = 200;

/**
 * Both bounds optional: `null` means the owner set no limit. When a bound is
 * set it must be finite and positive, the day inside the month, the month under
 * the server ceiling.
 */
export const AiLimitsPayload = Schema.Struct({
  perDayUsd: Schema.NullOr(
    Schema.Number.check(
      Schema.makeFilter((value) =>
        Number.isFinite(value) && value > 0 ? undefined : 'perDayUsd must be positive',
      ),
    ),
  ),
  perMonthUsd: Schema.NullOr(
    Schema.Number.check(
      Schema.makeFilter((value) =>
        Number.isFinite(value) && value > 0 ? undefined : 'perMonthUsd must be positive',
      ),
    ),
  ),
}).check(
  Schema.makeFilter((value) =>
    value.perDayUsd === null || value.perMonthUsd === null || value.perDayUsd <= value.perMonthUsd
      ? undefined
      : 'perDayUsd must not be greater than perMonthUsd',
  ),
  Schema.makeFilter((value) =>
    value.perMonthUsd === null || value.perMonthUsd <= MAX_MONTHLY_USD
      ? undefined
      : `perMonthUsd must be at most ${MAX_MONTHLY_USD}`,
  ),
);

// Strings are trimmed before the length checks, so a client encodes (and
// sends) the trimmed form.
const Name = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64));
const Persona = Schema.Trim.check(Schema.isMaxLength(4000));
const ConnectionId = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const Model = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const MachineId = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(128));

/** Strict: an unknown key is a 400. An absent `limits` means no limits. */
export const CreateAiPayload = Schema.Struct({
  name: Name,
  template: AiTemplate,
  persona: Schema.optional(Persona),
  providerConnectionId: ConnectionId,
  model: Model,
  limits: Schema.optional(AiLimitsPayload),
});

/** Strict, any subset, but a new provider connection needs an explicit model. */
export const UpdateAiPayload = Schema.Struct({
  name: Schema.optional(Name),
  persona: Schema.optional(Persona),
  limits: Schema.optional(AiLimitsPayload),
  model: Schema.optional(Model),
  providerConnectionId: Schema.optional(ConnectionId),
  // T-0474: the two delegation opt-ins (plan §8, decision 3). Owner only.
  canDelegate: Schema.optional(Schema.Boolean),
  acceptsDelegation: Schema.optional(Schema.Boolean),
  // T-1409/T-1423: where the AI's computer runs. `runner` and `auto` require
  // the AI to have an assigned machine, refused with a 400 otherwise.
  computerMode: Schema.optional(AiComputerMode),
}).check(
  Schema.makeFilter((value) =>
    value.providerConnectionId === undefined || value.model !== undefined
      ? undefined
      : 'A new provider connection needs an explicit model',
  ),
);

/** Strict; `null` clears the assignment. */
export const AssignMachinePayload = Schema.Struct({
  machineId: Schema.NullOr(MachineId),
});

// T-1422: stops the turn running in one chat. `chatJid` is the client chat id
// the owner sees: the AI's own JID in a DM, the room JID in a group/topic.
const ChatJid = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(512));

export const StopTurnPayload = Schema.Struct({ chatJid: ChatJid });

/** T-1422: `true` when a running turn in that chat was stopped, `false` when
 * none was running (or the gateway is not up). */
export const StopTurnResult = Schema.Struct({ stopped: Schema.Boolean });

// T-1408: a `null` bound means the owner set no limit; the budget check and
// the warnings only run for a bound that is set.
export const AiLimits = Schema.Struct({
  perDayUsd: Schema.NullOr(Schema.Number),
  perMonthUsd: Schema.NullOr(Schema.Number),
});

export type AiLimits = typeof AiLimits.Type;

// T-0058: the AI's spend summary. Null (or absent from an older server) when
// the spend read fails.
export const AiUsage = Schema.Struct({
  todayUsd: Schema.Number,
  windowUsd: Schema.Number,
});

export type AiUsage = typeof AiUsage.Type;

/**
 * One AI as its owner sees it. `status` `stopped` is the owner kill switch
 * (T-0080). `machineId` is the AI's home machine (T-0091), `null` on the
 * platform; a non-string value reads as `null`, and an absent key (an older
 * server) stays absent. `avatarUrl`
 * (T-0165) is absent when the AI has no picture. The delegation opt-ins
 * (T-0478) are optional so older payloads parse (read as off).
 */
export const PublicAi = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  template: AiTemplate,
  persona: Schema.String,
  model: Schema.String,
  jid: Schema.String,
  status: Schema.Literals(['active', 'disabled', 'stopped']),
  providerConnectionId: Schema.String,
  limits: AiLimits,
  usage: Schema.optional(Schema.NullOr(AiUsage)),
  machineId: LenientOptionalNullableString,
  avatarUrl: Schema.optional(Schema.String),
  canDelegate: Schema.optional(Schema.Boolean),
  acceptsDelegation: Schema.optional(Schema.Boolean),
  // T-1409: the AI's computer mode. Optional so a payload from an older
  // server still parses; a missing value reads as `off`.
  computerMode: Schema.optional(AiComputerMode),
  createdAt: Schema.String,
});

export type PublicAi = typeof PublicAi.Type;

// T-1395: the models.dev catalog behind the wizard's model step. The server
// fetches models.dev, keeps our six LLM providers (identity ids, see
// `apps/server/src/ai/catalog.ts`) and caches the result for 24 h. The
// answer groups the models per provider, newest first. `source` says where it
// came from: a live fetch, the last good copy, or the static list.
export const AiCatalogModel = Schema.Struct({
  /** Exactly the model id the provider expects (OpenRouter: `vendor/model`). */
  id: Schema.String,
  name: Schema.String,
  /** Context window in tokens; 0 when the catalog did not say. */
  contextTokens: Schema.Number,
  /** USD per million tokens; null when the catalog did not say. */
  inputPricePerMTok: Schema.NullOr(Schema.Number),
  outputPricePerMTok: Schema.NullOr(Schema.Number),
  toolCalls: Schema.Boolean,
  reasoning: Schema.Boolean,
  releaseDate: Schema.String,
});

export type AiCatalogModel = typeof AiCatalogModel.Type;

export const AiCatalogProvider = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  models: Schema.Array(AiCatalogModel),
});

export type AiCatalogProvider = typeof AiCatalogProvider.Type;

export const AiCatalog = Schema.Struct({
  providers: Schema.Array(AiCatalogProvider),
  source: Schema.Literals(['models.dev', 'cache', 'fallback']),
  fetchedAt: Schema.String,
});

export type AiCatalog = typeof AiCatalog.Type;

const AiIdParams = Schema.Struct({ id: Schema.String });

export const AisGroup = HttpApiGroup.make('ais')
  .add(
    HttpApiEndpoint.get('list', '/ais', {
      success: Schema.Array(PublicAi),
    }),
    HttpApiEndpoint.get('detail', '/ais/:id', {
      params: AiIdParams,
      success: PublicAi,
    }),
    // T-1425: whether Zilar cloud desks are available, so the Computer picker
    // can disable the cloud option. Session-required, read-only.
    HttpApiEndpoint.get('computerOptions', '/ais/computer-options', {
      success: AiComputerOptions,
    }),
    HttpApiEndpoint.post('create', '/ais', {
      payload: CreateAiPayload,
      success: PublicAi.pipe(HttpApiSchema.status(201)),
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(AisConfigured),
    HttpApiEndpoint.patch('patch', '/ais/:id', {
      params: AiIdParams,
      payload: UpdateAiPayload,
      success: PublicAi,
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(AisConfigured),
    HttpApiEndpoint.delete('remove', '/ais/:id', {
      params: AiIdParams,
      success: HttpApiSchema.NoContent,
    }).middleware(AisConfigured),
    HttpApiEndpoint.post('stop', '/ais/:id/stop', {
      params: AiIdParams,
      success: PublicAi,
    }),
    HttpApiEndpoint.post('resume', '/ais/:id/resume', {
      params: AiIdParams,
      success: PublicAi,
    }),
    // T-1422: stops the turn running in one chat. Owner only, like the other
    // AI routes; not the AI kill switch above.
    HttpApiEndpoint.post('stopTurn', '/ais/:id/turns/stop', {
      params: AiIdParams,
      payload: StopTurnPayload,
      success: StopTurnResult,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    HttpApiEndpoint.put('assignMachine', '/ais/:id/machine', {
      params: AiIdParams,
      payload: AssignMachinePayload,
      success: PublicAi,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
    // T-1395: the models.dev model catalog; read-only, so it needs no
    // configured gateway. Path is `/api/ai/catalog` (group prefix `/api`).
    HttpApiEndpoint.get('catalog', '/ai/catalog', {
      success: AiCatalog,
    }),
  )
  .middleware(Session)
  .middleware(AisSchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
