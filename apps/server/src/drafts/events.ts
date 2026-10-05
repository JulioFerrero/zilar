import { z } from 'zod';

// The draft-stream contract (T-0041, consumed by the web app in T-0043 without
// changes). Drafts carry the AI's cumulative reply text while the model
// writes; the final message still goes through XMPP, followed by `end`.
//
// - `chatJid` is the AI's bare JID (the DM the final message lands in).
// - `turnId` is one UUID per gateway turn, so a client can group a run of
//   `draft` events with its closing `end`.
// - `text` is cumulative: a dropped draft is harmless, and a client that
//   connects mid-turn renders the next one.
// - Tool-call arguments are never in a draft. They could carry a persona,
//   which must never leave the server except in the owner's own DM.
export const DraftEventSchema = z.object({
  type: z.literal('draft'),
  chatJid: z.string().min(1),
  turnId: z.string().uuid(),
  text: z.string(),
});

export const DraftEndEventSchema = z.object({
  type: z.literal('end'),
  chatJid: z.string().min(1),
  turnId: z.string().uuid(),
  outcome: z.enum(['sent', 'failed']),
});

// `sent` is published after the final XMPP message is sent (notices
// included); `failed` after the failure text is sent.
export const DraftHubEventSchema = z.discriminatedUnion('type', [
  DraftEventSchema,
  DraftEndEventSchema,
]);

export type DraftEvent = z.infer<typeof DraftEventSchema>;
export type DraftEndEvent = z.infer<typeof DraftEndEventSchema>;
export type DraftHubEvent = z.infer<typeof DraftHubEventSchema>;
