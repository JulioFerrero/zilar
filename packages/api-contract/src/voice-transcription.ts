// Voice transcription (T-1088): the enabled flag and the transcript result,
// shared by the server's routes and the mock backend so the two shapes cannot
// drift.

import { Schema } from 'effect';

// Every field of the handler's return value, so no field is stripped by the
// success encoder (recipe item 8).
export const EnabledStatus = Schema.Struct({ enabled: Schema.Boolean });

export type EnabledStatus = typeof EnabledStatus.Type;

export const TranscriptResult = Schema.Struct({ text: Schema.String });

export type TranscriptResult = typeof TranscriptResult.Type;
