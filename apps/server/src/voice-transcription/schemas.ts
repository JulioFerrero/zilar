import { Schema } from 'effect';

// The response shapes shared with the mock backend (T-1088); re-exported so
// `api.ts` and the other importers of this module keep working.
export { EnabledStatus, TranscriptResult } from '@zilar/api-contract';

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
