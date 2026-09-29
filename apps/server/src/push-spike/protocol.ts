import { z } from 'zod';

// The XEP-0357 push JID + node pair a browser registers (enable step 5).
// The node is the delivery target the push service (this component) owns.
export const PUSH_NAMESPACE = 'urn:xmpp:push:0';
export const PUBSUB_NAMESPACE = 'http://jabber.org/protocol/pubsub';
export const DATA_FORMS_NAMESPACE = 'jabber:x:data';
export const PUSH_SUMMARY_FORM_TYPE = 'urn:xmpp:push:summary';

const NodeSchema = z
  .string()
  .min(1, 'must not be empty')
  .max(256, 'must be at most 256 characters')
  .regex(/^[A-Za-z0-9._~-]{1,256}$/, 'must be URL-safe (letters, digits, ".", "_", "~", "-")');

// What ejabberd's mod_push sends inside `<notification/>`, read from
// mod_push.erl `make_summary/3`: message-count is always absent in ejabberd
// (the spec example shows it, the implementation never sets it), and with
// include_sender/include_body the fields below may appear.
export const PushNotificationSchema = z.object({
  node: z.string().min(1),
  from: z.string().min(1),
  publishOptionsSecret: z.string().optional(),
  messageCount: z.string().optional(),
  lastMessageSender: z.string().optional(),
  lastMessageBody: z.string().optional(),
});
export type PushNotification = z.infer<typeof PushNotificationSchema>;

export function parseNode(value: unknown): string {
  return NodeSchema.parse(value);
}

export function nodeForUser(userId: string): string {
  const digest = stableHash(userId);
  return `spike-${digest}`;
}

// FNV-1a over UTF-8 bytes, hex encoded. Deterministic so one user maps to
// one node without storing anything; randomness is not needed (the node is
// not a secret — the publish-options secret is).
function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  const bytes = Buffer.from(value, 'utf8');
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
