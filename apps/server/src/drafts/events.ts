import { Schema } from 'effect';

// The draft-stream contract: `chatJid` is the AI's bare JID, `turnId` groups a run of
// events, and `text` is cumulative, so a dropped draft is harmless. Tool-call arguments
// are never in a draft: a persona must not leave the server except in the owner's DM.
export const DraftEventSchema = Schema.Struct({
  type: Schema.Literal('draft'),
  chatJid: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  turnId: Schema.String.pipe(Schema.check(Schema.isUUID())),
  text: Schema.String,
});

export const DraftEndEventSchema = Schema.Struct({
  type: Schema.Literal('end'),
  chatJid: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  turnId: Schema.String.pipe(Schema.check(Schema.isUUID())),
  outcome: Schema.Literals(['sent', 'failed']),
});

// `sent` is published after the final XMPP message, `failed` after the failure text.
export const DraftHubEventSchema = Schema.Union([DraftEventSchema, DraftEndEventSchema]);

export type DraftEvent = typeof DraftEventSchema.Type;
export type DraftHubEvent = typeof DraftHubEventSchema.Type;
