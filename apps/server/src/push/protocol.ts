import { randomBytes } from 'node:crypto';
import { Schema } from 'effect';
import { struct } from '@zilar/protocol';

// The XEP-0357 push JID + node pair a browser registers; one random node
// per device, so each subscription gets its own independently removable
// publish stream.
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

// What mod_push sends inside `<notification/>`: message-count is never set
// by ejabberd, and the sender/body fields only appear with those options
// on. Production keeps both off, so the component resolves who and what
// from the archive.
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

// One random node per registration: URL-safe, unique, and unguessable
// enough that a node cannot be probed for another user's device, so the
// characters come from the CSPRNG.
export function randomNode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  // 256 is not a multiple of 62, so mapping bytes straight would bias the
  // alphabet; 248 is the largest usable multiple, and bytes above it are
  // redrawn.
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
