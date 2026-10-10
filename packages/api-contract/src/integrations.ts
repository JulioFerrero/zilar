// Owner integrations (T-0544, T-0895): the Telegram bot token and the sign-in
// mail sender plus Resend key. The token and the key are write-only; the
// status only says whether one is set. Anyone but the server owner gets the
// same 404 as an unknown route.

import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import {
  ChainDSchemaErrors,
  IntegrationsEmailRateLimit,
  IntegrationsTelegramRateLimit,
} from './chain-d-middleware';
import { Session } from './middleware';

/** A bare address or a display name plus angle-addr. */
export function isMailbox(value: string): boolean {
  const trimmed = value.trim();
  const angle = trimmed.match(/^(.*)<([^<>]+)>$/);
  const address = (angle?.[2] ?? trimmed).trim();
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(address);
}

/** Trimmed before the length and no-spaces checks; a client sends it trimmed. */
export const SaveTelegramTokenPayload = Schema.Struct({
  botToken: Schema.Trim.pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(256),
      Schema.makeFilter((value) =>
        /\s/.test(value) ? 'botToken must not contain spaces' : undefined,
      ),
    ),
  ),
});

/** `resendApiKey` changes the key only when given. */
export const SaveEmailPayload = Schema.Struct({
  from: Schema.Trim.pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(320),
      Schema.makeFilter((value) =>
        /[\r\n]/.test(value) ? 'from must be a valid sender address' : undefined,
      ),
      Schema.makeFilter((value) =>
        isMailbox(value) ? undefined : 'from must be a valid sender address',
      ),
    ),
  ),
  resendApiKey: Schema.optional(
    Schema.Trim.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
  ),
});

const IntegrationSource = Schema.NullOr(Schema.Literals(['env', 'stored']));

export const TelegramIntegrationStatus = Schema.Struct({
  configured: Schema.Boolean,
  source: IntegrationSource,
});

export const EmailIntegrationStatus = Schema.Struct({
  configured: Schema.Boolean,
  source: IntegrationSource,
  from: Schema.NullOr(Schema.String),
});

export const VoiceIntegrationStatus = Schema.Struct({
  configured: Schema.Boolean,
  baseUrl: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
});

export type TelegramIntegrationStatus = typeof TelegramIntegrationStatus.Type;
export type EmailIntegrationStatus = typeof EmailIntegrationStatus.Type;
export type VoiceIntegrationStatus = typeof VoiceIntegrationStatus.Type;

/** `voiceTranscription` is optional so an older server still decodes. */
export const IntegrationsStatus = Schema.Struct({
  telegram: TelegramIntegrationStatus,
  email: EmailIntegrationStatus,
  voiceTranscription: Schema.optional(VoiceIntegrationStatus),
  canManage: Schema.Boolean,
});

export type IntegrationsStatus = typeof IntegrationsStatus.Type;

export const IntegrationsOk = Schema.Struct({ ok: Schema.Boolean });

export const IntegrationsGroup = HttpApiGroup.make('integrations')
  .add(
    HttpApiEndpoint.get('status', '/settings/integrations', {
      success: IntegrationsStatus,
    }),
    HttpApiEndpoint.put('setTelegram', '/settings/integrations/telegram', {
      payload: SaveTelegramTokenPayload,
      success: IntegrationsOk,
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(IntegrationsTelegramRateLimit),
    HttpApiEndpoint.delete('removeTelegram', '/settings/integrations/telegram', {
      success: IntegrationsOk,
    }),
    HttpApiEndpoint.put('setEmail', '/settings/integrations/email', {
      payload: SaveEmailPayload,
      success: IntegrationsOk,
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(IntegrationsEmailRateLimit),
  )
  .middleware(Session)
  .middleware(ChainDSchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
