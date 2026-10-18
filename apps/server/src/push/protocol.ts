import { randomBytes } from 'node:crypto';
import { Schema } from 'effect';
import { struct } from '@zilar/protocol';

// The XEP-0357 push JID + node pair a browser registers (enable step).
// The node is the delivery target the push service (this component) owns:
// one random node per device, so each browser subscription gets its own
// publish stream and can be removed independently.
export const PUSH_NAMESPACE = 'urn:xmpp:push:0';
export const PUBSUB_NAMESPACE = 'http://jabber.org/protocol/pubsub';
export const DATA_FORMS_NAMESPACE = 'jabber:x:data';
export const PUSH_SUMMARY_FORM_TYPE = 'urn:xmpp:push:summary';

const NodeSchema = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(256),
    Schema.isPattern(/^[A-Za-z0-9._~-]{1,256}$/),
  ),
);
const decodeNode = Schema.decodeUnknownSync(NodeSchema);

// What ejabberd's mod_push sends inside `<notification/>`, read from
// mod_push.erl `make_summary/3`: message-count is always absent in ejabberd
// (the spec example shows it, the implementation never sets it), and with
// include_sender/include_body the fields below may appear. Production keeps
// both off, so the component resolves who and what itself from the archive.
export const PushNotificationSchema = struct({
  node: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  from: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  messageCount: Schema.optional(Schema.String),
  lastMessageSender: Schema.optional(Schema.String),
  lastMessageBody: Schema.optional(Schema.String),
});
export type PushNotification = typeof PushNotificationSchema.Type;

export function parseNode(value: unknown): string {
  return decodeNode(value);
}

// One random node per device registration (`p` + 32 base62 characters:
// URL-safe under the schema above). The node is not a secret, but it must be
// unique (the column is unique) and unguessable enough that a node cannot be
// probed for another user's device, so the characters come from the CSPRNG.
export function randomNode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  // 256 is not a multiple of 62, so mapping raw bytes straight to the
  // alphabet would bias it. 248 is the largest multiple of 62 that fits in a
  // byte; bytes above it are rejected and redrawn.
  const limit = 248;
  const chars: string[] = ['p'];
  while (chars.length <= 32) {
    for (const byte of randomBytes(32)) {
      if (byte >= limit) {
        continue;
      }
      chars.push(alphabet.charAt(byte % alphabet.length));
      if (chars.length > 32) {
        break;
      }
    }
  }
  return chars.join('');
}
