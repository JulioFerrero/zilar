import { z } from 'zod';

export const VoiceTranscriptSchema = z.strictObject({
  text: z.string().max(20000),
  language: z.string().min(2).max(10).optional(),
  source: z.enum(['api', 'local']),
});

export type VoiceTranscript = z.infer<typeof VoiceTranscriptSchema>;

export const VoiceMetaSchema = z.strictObject({
  duration_ms: z.int().min(1).max(3_600_000),
  mime: z.string().min(1),
  waveform: z.array(z.int().min(0).max(255)).min(1).max(128),
  transcript: VoiceTranscriptSchema.optional(),
});

export type VoiceMeta = z.infer<typeof VoiceMetaSchema>;
