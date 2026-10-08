import { Schema } from 'effect';
import { isUrl, struct } from './common';

export const VoiceTranscriptSchema = struct({
  text: Schema.String.pipe(Schema.check(Schema.isMaxLength(20000))),
  language: Schema.optional(
    Schema.String.pipe(Schema.check(Schema.isMinLength(2), Schema.isMaxLength(10))),
  ),
  source: Schema.Literals(['api', 'local']),
});

export type VoiceTranscript = typeof VoiceTranscriptSchema.Type;

const UrlSchema = Schema.String.pipe(
  Schema.check(
    Schema.isMaxLength(8192),
    Schema.makeFilter((value) => (isUrl(value) ? undefined : 'must be a URL')),
  ),
);

export const VoiceMetaSchema = struct({
  duration_ms: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(3_600_000)),
  ),
  mime: Schema.String.pipe(
    Schema.check(
      Schema.isMaxLength(100),
      Schema.makeFilter((value) =>
        value.startsWith('audio/') ? undefined : 'must be an audio mime',
      ),
    ),
  ),
  waveform: Schema.mutable(
    Schema.Array(
      Schema.Int.pipe(
        Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(255)),
      ),
    ),
  ).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
  /** Where the receiving client fetches the audio (an XEP-0363 download URL). */
  url: Schema.optional(UrlSchema),
  transcript: Schema.optional(VoiceTranscriptSchema),
});

export type VoiceMeta = typeof VoiceMetaSchema.Type;
