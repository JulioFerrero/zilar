import { z } from 'zod';

// The XEP-0357 push JID + node pair a browser registers (enable step).
// The node is the delivery target the push service (this component) owns:
// one random node per device, so each browser subscription gets its own
// publish stream and can be removed independently.
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
// include_sender/include_body the fields below may appear. Production keeps
// both off, so the component resolves who and what itself from the archive.
export const PushNotificationSchema = z.object({
  node: z.string().min(1),
  from: z.string().min(1),
  messageCount: z.string().optional(),
  lastMessageSender: z.string().optional(),
  lastMessageBody: z.string().optional(),
});
export type PushNotification = z.infer<typeof PushNotificationSchema>;

export function parseNode(value: unknown): string {
  return NodeSchema.parse(value);
}

// One random node per device registration (`p` + 32 base62 characters:
// URL-safe under the schema above). Randomness is not load-bearing — the
// node is not a secret — but it must be unique (the column is unique) and
// unguessable enough that a node cannot be probed for another user's device.
export function randomNode(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let node = 'p';
  for (let index = 0; index < 32; index += 1) {
    node += alphabet[Math.floor(random() * alphabet.length)] ?? 'A';
  }
  return node;
}
