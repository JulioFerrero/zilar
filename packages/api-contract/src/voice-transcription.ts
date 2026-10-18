import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { SchemaErrors, Session, TranscriptConfigured, VoiceSettingsOwnerLimit } from './middleware';

export const EnabledStatus = Schema.Struct({ enabled: Schema.Boolean });

export type EnabledStatus = typeof EnabledStatus.Type;

export const TranscriptResult = Schema.Struct({ text: Schema.String });

export type TranscriptResult = typeof TranscriptResult.Type;

export const TranscriptBody = Schema.Struct({
  url: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
});

export const VoiceSettingsBody = Schema.Struct({
  baseUrl: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  apiKey: Schema.optional(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(512))),
  model: Schema.optional(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
});

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
