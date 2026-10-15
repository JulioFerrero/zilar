import { xml, type XmppElement } from '@xmpp/client';
import { type ForwardOrigin, type Payload } from '@zilar/protocol';
import {
  CORRECTION_NAMESPACE,
  FALLBACK_NAMESPACE,
  HINTS_NAMESPACE,
  REFERENCE_NAMESPACE,
  REPLY_NAMESPACE,
  RETRACTION_NAMESPACE,
  STANZA_ID_NAMESPACE,
  ZILAR_FORWARD_NAMESPACE,
} from '../namespaces';
import type { ChatKind, MentionInput, MessageAlbum } from '../types';
import { albumElement } from './album';
import { pushPayloadElement } from './payload-element';
import { MAX_MENTIONS, codePointLength, codePointOffset } from './reactions';

export {
  MAX_STATUS_CHARS,
  buildTyping,
  buildDisplayed,
  buildPingRequest,
  buildPingResult,
  buildReactions,
  buildJoinPresence,
  buildLeavePresence,
  buildAvailablePresence,
  buildCarbonsEnable,
  buildPushEnable,
  buildPushDisable,
  buildUploadSlotRequest,
  parseUploadSlot,
  buildRosterResult,
  buildRosterError,
} from './build-control';

// ---------------------------------------------------------------------------
// Outgoing stanzas
// ---------------------------------------------------------------------------

// A Zilar forward origin (namespace `urn:zilar:forward:0`, distinct from
// XEP-0297's `urn:xmpp:forward:0`). Long strings travel as child text, ids and
// the time as attributes; `id` and `<chat>` only appear when present.
function forwardElement(origin: ForwardOrigin): XmppElement {
  const attrs: Record<string, string> = {
    xmlns: ZILAR_FORWARD_NAMESPACE,
    sender: origin.sender_id,
    at: origin.original_at,
  };
  if (origin.original_id !== undefined) {
    attrs['id'] = origin.original_id;
  }
  const children: XmppElement[] = [xml('name', {}, origin.sender_name)];
  if (origin.chat_id !== undefined && origin.chat_name !== undefined) {
    children.push(xml('chat', { jid: origin.chat_id, name: origin.chat_name }));
  }
  return xml('forward', attrs, ...children);
}

// XEP-0461/XEP-0428: a reply quotes the replied-to message as a leading "> …"
// line in the body when its text is known, so a client that cannot resolve the
// `<reply/>` id still shows the quote. The fallback range names that line: the
// "> " marker is two code points and the trailing newline is not part of it.
function replyQuotePrefix(quote: string | undefined): string {
  if (quote === undefined || quote === '') {
    return '';
  }
  return `> ${quote.split('\n')[0] ?? ''}\n`;
}

function replyFallbackElement(prefix: string): XmppElement {
  return xml(
    'fallback',
    { xmlns: FALLBACK_NAMESPACE, for: REPLY_NAMESPACE },
    xml('body', { start: '2', end: String(codePointLength(prefix) - 1) }),
  );
}

// The fallback quote sits at the head of the body, so mention offsets (UTF-16
// code units into the text) shift by the prefix's own length.
function shiftMentions(
  mentions: MentionInput[] | undefined,
  shift: number,
): MentionInput[] | undefined {
  if (mentions === undefined || shift === 0) {
    return mentions;
  }
  return mentions.map((mention) => ({
    jid: mention.jid,
    begin: mention.begin + shift,
    end: mention.end + shift,
  }));
}

export function buildMessage(options: {
  id: string;
  to: string;
  kind: ChatKind;
  text: string;
  payload?: Payload | undefined;
  forward?: ForwardOrigin | undefined;
  replyTo?: { id: string; to?: string; text?: string } | undefined;
  mentions?: MentionInput[] | undefined;
  album?: MessageAlbum | undefined;
}): XmppElement {
  const replyTo = options.replyTo;
  const replyPrefix = replyQuotePrefix(replyTo?.text);
  const body = `${replyPrefix}${options.text}`;
  const children: XmppElement[] = [xml('body', {}, body)];

  pushPayloadElement(children, options.payload);

  // ejabberd's archive (mod_mam) only keeps a message that has text or an
  // explicit store hint. A voice note has an empty body and its data in the
  // payload, so without the hint it showed live but was gone after a reload
  // (device test 2026-10-03). The hint also covers any other body-less payload.
  if (options.payload === undefined && options.text === '') {
    children.push(xml('store', { xmlns: HINTS_NAMESPACE }));
  }

  if (options.forward !== undefined) {
    children.push(forwardElement(options.forward));
  }

  if (options.album !== undefined) children.push(albumElement(options.album));

  if (replyTo !== undefined) {
    const attrs: Record<string, string> = {
      xmlns: REPLY_NAMESPACE,
      id: replyTo.id,
    };
    if (replyTo.to !== undefined) {
      attrs['to'] = replyTo.to;
    }
    children.push(xml('reply', attrs));
    if (replyPrefix !== '') {
      children.push(replyFallbackElement(replyPrefix));
    }
  }

  pushMentionReferences(children, body, shiftMentions(options.mentions, replyPrefix.length));

  // XEP-0359: the sender-generated id stays the same across resends, so a
  // retried stanza dedupes on the receiver and in the archive.
  children.push(xml('origin-id', { xmlns: STANZA_ID_NAMESPACE, id: options.id }));

  return xml('message', { type: options.kind, to: options.to, id: options.id }, ...children);
}

// XEP-0308: the new full body plus a `<replace/>` naming the original by the
// sender-generated id. Mentions are rebuilt from the new text, as on a send.
export function buildCorrection(options: {
  id: string;
  to: string;
  kind: ChatKind;
  originalId: string;
  text: string;
  payload?: Payload | undefined;
  mentions?: MentionInput[] | undefined;
}): XmppElement {
  const children: XmppElement[] = [xml('body', {}, options.text)];
  children.push(xml('replace', { xmlns: CORRECTION_NAMESPACE, id: options.originalId }));
  pushPayloadElement(children, options.payload);
  pushMentionReferences(children, options.text, options.mentions);
  return xml('message', { type: options.kind, to: options.to, id: options.id }, ...children);
}

/** The fallback body a peer without XEP-0424 support sees on a retraction. */
export const RETRACTION_FALLBACK_BODY =
  "This person attempted to retract a previous message, but it's unsupported by your client.";

// XEP-0424: a `<retract/>` naming the target, a fallback, and the store hint so
// the server archives it in MAM.
export function buildRetraction(options: {
  id: string;
  to: string;
  kind: ChatKind;
  targetId: string;
}): XmppElement {
  return xml(
    'message',
    { type: options.kind, to: options.to, id: options.id },
    xml('retract', { xmlns: RETRACTION_NAMESPACE, id: options.targetId }),
    xml('fallback', { xmlns: FALLBACK_NAMESPACE, for: RETRACTION_NAMESPACE }),
    xml('body', {}, RETRACTION_FALLBACK_BODY),
    xml('store', { xmlns: HINTS_NAMESPACE }),
  );
}

// Shared mention builder for a send and an edit: a range that does not
// describe a real slice of the body is dropped rather than written broken.
function pushMentionReferences(
  children: XmppElement[],
  text: string,
  mentions: MentionInput[] | undefined,
): void {
  let written = 0;
  for (const mention of mentions ?? []) {
    if (written >= MAX_MENTIONS) break;
    if (
      !Number.isInteger(mention.begin) ||
      !Number.isInteger(mention.end) ||
      mention.begin < 0 ||
      mention.begin >= mention.end ||
      mention.end > text.length
    ) {
      continue;
    }
    children.push(
      xml('reference', {
        xmlns: REFERENCE_NAMESPACE,
        type: 'mention',
        uri: `xmpp:${mention.jid}`,
        begin: String(codePointOffset(text, mention.begin)),
        end: String(codePointOffset(text, mention.end)),
      }),
    );
    written += 1;
  }
}
