import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { LenientOptionalNullableString } from './lenient';
import { AisConfigured, AisSchemaErrors, Session } from './middleware';

export const AI_TEMPLATES = ['dev', 'marketing', 'fun', 'custom'] as const;

export const AiTemplate = Schema.Literals(AI_TEMPLATES);

export type AiTemplate = typeof AiTemplate.Type;

// `off` means none, `cloud` is Zilar cloud, `runner` the owner's machine and `auto` the owner's machine when online, else cloud.
export const AI_COMPUTER_MODES = ['off', 'cloud', 'runner', 'auto'] as const;

export const AiComputerMode = Schema.Literals(AI_COMPUTER_MODES);

export type AiComputerMode = typeof AiComputerMode.Type;

// `cloud` is true when the desk agent answers ready (gVisor installed); false disables the cloud option with "Needs setup on your server".
export const AiComputerOptions = Schema.Struct({
  cloud: Schema.Boolean,
});

export type AiComputerOptions = typeof AiComputerOptions.Type;

/** The server ceiling for an AI's monthly spend limit. */
export const MAX_MONTHLY_USD = 200;

// `null` means no limit; a set bound must be finite and positive, the day inside the month, the month under the server ceiling.
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

const Name = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64));
const Persona = Schema.Trim.check(Schema.isMaxLength(4000));
const ConnectionId = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const Model = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const MachineId = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(128));

export const CreateAiPayload = Schema.Struct({
  name: Name,
  template: AiTemplate,
  persona: Schema.optional(Persona),
  providerConnectionId: ConnectionId,
  model: Model,
  limits: Schema.optional(AiLimitsPayload),
});

// Strict, any subset, but a new provider connection needs an explicit model.
export const UpdateAiPayload = Schema.Struct({
  name: Schema.optional(Name),
  persona: Schema.optional(Persona),
  limits: Schema.optional(AiLimitsPayload),
  model: Schema.optional(Model),
  providerConnectionId: Schema.optional(ConnectionId),
  canDelegate: Schema.optional(Schema.Boolean),
  acceptsDelegation: Schema.optional(Schema.Boolean),
  // `runner` and `auto` require an assigned machine; refused with a 400 otherwise.
  computerMode: Schema.optional(AiComputerMode),
}).check(
  Schema.makeFilter((value) =>
    value.providerConnectionId === undefined || value.model !== undefined
      ? undefined
      : 'A new provider connection needs an explicit model',
  ),
);

export const AssignMachinePayload = Schema.Struct({
  machineId: Schema.NullOr(MachineId),
});

// `chatJid` is the AI's own JID in a DM, the room JID in a group/topic.
const ChatJid = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(512));

export const StopTurnPayload = Schema.Struct({ chatJid: ChatJid });

export const StopTurnResult = Schema.Struct({ stopped: Schema.Boolean });

// `null` means no limit; the budget check and warnings only run for a bound that is set.
export const AiLimits = Schema.Struct({
  perDayUsd: Schema.NullOr(Schema.Number),
  perMonthUsd: Schema.NullOr(Schema.Number),
});

export type AiLimits = typeof AiLimits.Type;

// Null (or absent from an older server) when the spend read fails.
export const AiUsage = Schema.Struct({
  todayUsd: Schema.Number,
  windowUsd: Schema.Number,
});

export type AiUsage = typeof AiUsage.Type;

// `status` `stopped` is the owner kill switch.
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
  lastFailure: Schema.optional(
    Schema.NullOr(Schema.Struct({ kind: Schema.String, at: Schema.String })),
  ),
  machineId: LenientOptionalNullableString,
  avatarUrl: Schema.optional(Schema.String),
  canDelegate: Schema.optional(Schema.Boolean),
  acceptsDelegation: Schema.optional(Schema.Boolean),
  computerMode: Schema.optional(AiComputerMode),
  createdAt: Schema.String,
});

export type PublicAi = typeof PublicAi.Type;

// The server fetches models.dev, keeps our six native providers plus every OpenAI-compatible one, and caches the result for 24 h.
// `source` says where it came from: a live fetch, the last good copy, or the static list.
export const AiCatalogModel = Schema.Struct({
  /** Exactly the model id the provider expects (OpenRouter: `vendor/model`). */
  id: Schema.String,
  name: Schema.String,
  // Context window in tokens; 0 when the catalog did not say.
  contextTokens: Schema.Number,
  // USD per million tokens; null when the catalog did not say.
  inputPricePerMTok: Schema.NullOr(Schema.Number),
  outputPricePerMTok: Schema.NullOr(Schema.Number),
  toolCalls: Schema.Boolean,
  reasoning: Schema.Boolean,
  releaseDate: Schema.String,
});

export type AiCatalogModel = typeof AiCatalogModel.Type;

// `native` is one of our six providers (a fixed key and base URL); `compatible` speaks the OpenAI-compatible API and its base URL stays on the server.
export const AI_CATALOG_PROVIDER_KINDS = ['native', 'compatible'] as const;

export const AiCatalogProviderKind = Schema.Literals(AI_CATALOG_PROVIDER_KINDS);

export type AiCatalogProviderKind = typeof AiCatalogProviderKind.Type;

export const AiCatalogProvider = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: Schema.optional(AiCatalogProviderKind),
  docUrl: Schema.optional(Schema.String),
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
    HttpApiEndpoint.get('catalog', '/ai/catalog', {
      success: AiCatalog,
    }),
  )
  .middleware(Session)
  .middleware(AisSchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
