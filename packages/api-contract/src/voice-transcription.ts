// Voice transcription (T-1088, moved into the contract by T-1113): the
// enabled flag, the transcript result, the request/response shapes and the
// group, shared by the server's routes, the web client and the mock backend so
// the shapes cannot drift.

import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { SchemaErrors, Session, TranscriptConfigured, VoiceSettingsOwnerLimit } from './middleware';

// Every field of the handler's return value, so no field is stripped by the
// success encoder (recipe item 8).
export const EnabledStatus = Schema.Struct({ enabled: Schema.Boolean });

export type EnabledStatus = typeof EnabledStatus.Type;

export const TranscriptResult = Schema.Struct({ text: Schema.String });

export type TranscriptResult = typeof TranscriptResult.Type;

// Replaces `transcriptBodySchema` (zod): a non-empty URL of at most 2048
// characters. Strict (`PayloadParseOptions` below) so an excess key fails like
// the old `.strict()`.
export const TranscriptBody = Schema.Struct({
  url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
});

// Replaces `voiceSettingsBodySchema` (zod): trimmed before the length checks,
// exactly like the old `.trim().min()/.max()`. Strict like the old `.strict()`.
export const VoiceSettingsBody = Schema.Struct({
  baseUrl: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  apiKey: Schema.optional(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(512))),
  model: Schema.optional(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
});

// Every field of the handler's return value, so no field is stripped by the
// success encoder (recipe item 8): `{ ok: true }`.
export const OkResult = Schema.Struct({ ok: Schema.Boolean });

export const VoiceTranscriptionGroup = HttpApiGroup.make('voiceTranscription')
  .add(
    HttpApiEndpoint.get('status', '/voice/transcription', {
      success: EnabledStatus,
    }),
    HttpApiEndpoint.post('transcript', '/voice/transcript', {
      payload: TranscriptBody,
      success: TranscriptResult,
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(TranscriptConfigured),
    HttpApiEndpoint.put('setSettings', '/settings/integrations/voice-transcription', {
      payload: VoiceSettingsBody,
      success: OkResult,
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })
      .middleware(VoiceSettingsOwnerLimit),
    HttpApiEndpoint.delete('removeSettings', '/settings/integrations/voice-transcription', {
      success: OkResult,
    }),
  )
  .middleware(Session)
  .middleware(SchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');
