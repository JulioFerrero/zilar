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

/** The server ceiling for an AI's monthly spend limit. */
export const MAX_MONTHLY_USD = 200;

/**
 * Both bounds finite and positive, the day inside the month, the month under
 * the server ceiling.
 */
export const AiLimitsPayload = Schema.Struct({
  perDayUsd: Schema.Number.check(
    Schema.makeFilter((value) =>
      Number.isFinite(value) && value > 0 ? undefined : 'perDayUsd must be positive',
    ),
  ),
  perMonthUsd: Schema.Number.check(
    Schema.makeFilter((value) =>
      Number.isFinite(value) && value > 0 ? undefined : 'perMonthUsd must be positive',
    ),
  ),
}).check(
  Schema.makeFilter((value) =>
    value.perDayUsd <= value.perMonthUsd
      ? undefined
      : 'perDayUsd must not be greater than perMonthUsd',
  ),
  Schema.makeFilter((value) =>
    value.perMonthUsd <= MAX_MONTHLY_USD
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

/** Strict: an unknown key is a 400. */
export const CreateAiPayload = Schema.Struct({
  name: Name,
  template: AiTemplate,
  persona: Schema.optional(Persona),
  providerConnectionId: ConnectionId,
  model: Model,
  limits: AiLimitsPayload,
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

export const AiLimits = Schema.Struct({
  perDayUsd: Schema.Number,
  perMonthUsd: Schema.Number,
});

export type AiLimits = typeof AiLimits.Type;

// T-0058: the AI's spend summary. Null (or absent from an older server) when
// LiteLLM cannot be reached.
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
  createdAt: Schema.String,
});

export type PublicAi = typeof PublicAi.Type;

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
    HttpApiEndpoint.put('assignMachine', '/ais/:id/machine', {
      params: AiIdParams,
      payload: AssignMachinePayload,
      success: PublicAi,
    }).annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' }),
  )
  .middleware(Session)
  .middleware(AisSchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
