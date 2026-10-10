import { xml, type XmppElement } from '@xmpp/client';
import { encodePayload, type ForwardOrigin, type Payload } from '@zilar/protocol';
import {
  AGENT_NAMESPACE,
  CARBONS_NAMESPACE,
  CHAT_MARKERS_NAMESPACE,
  CHAT_STATES_NAMESPACE,
  CORRECTION_NAMESPACE,
  FALLBACK_NAMESPACE,
  HINTS_NAMESPACE,
  HTTP_UPLOAD_NAMESPACE,
  MUC_NAMESPACE,
  PING_NAMESPACE,
  PUSH_NAMESPACE,
  REACTIONS_NAMESPACE,
  REFERENCE_NAMESPACE,
  REPLY_NAMESPACE,
  RETRACTION_NAMESPACE,
  STANZA_NAMESPACE,
  ZILAR_FORWARD_NAMESPACE,
} from '../namespaces';
import type { ChatKind, MentionInput, UploadSlot } from '../types';
import { MAX_MENTIONS, codePointOffset, sanitizeReactions, type ReplyRef } from './reactions';

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

export function buildMessage(options: {
  id: string;
  to: string;
  kind: ChatKind;
  text: string;
  payload?: Payload | undefined;
  forward?: ForwardOrigin | undefined;
  replyTo?: ReplyRef | undefined;
  mentions?: MentionInput[] | undefined;
}): XmppElement {
  const children: XmppElement[] = [xml('body', {}, options.text)];

  if (options.payload !== undefined) {
    children.push(xml('agent', { xmlns: AGENT_NAMESPACE }, encodePayload(options.payload)));
  }

  // ejabberd's archive (mod_mam) only keeps a message that has text or an
  // explicit store hint. A voice note has an empty body and its data in the
  // payload, so without the hint it showed live but was gone after a reload
  // (device test 2026-10-03). The hint also covers any other body-less payload.
  if (options.payload !== undefined || options.text === '') {
    children.push(xml('store', { xmlns: HINTS_NAMESPACE }));
  }

  if (options.forward !== undefined) {
    children.push(forwardElement(options.forward));
  }

  if (options.replyTo !== undefined) {
    const attrs: Record<string, string> = {
      xmlns: REPLY_NAMESPACE,
      id: options.replyTo.id,
    };
    if (options.replyTo.to !== undefined) {
      attrs['to'] = options.replyTo.to;
    }
    children.push(xml('reply', attrs));
  }

  pushMentionReferences(children, options.text, options.mentions);

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
  mentions?: MentionInput[] | undefined;
}): XmppElement {
  const children: XmppElement[] = [
    xml('body', {}, options.text),
    xml('replace', { xmlns: CORRECTION_NAMESPACE, id: options.originalId }),
  ];
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

export function buildTyping(options: {
  to: string;
  kind: ChatKind;
  state: 'composing' | 'paused' | 'active';
}): XmppElement {
  return xml(
    'message',
    { type: options.kind, to: options.to },
    xml(options.state, { xmlns: CHAT_STATES_NAMESPACE }),
  );
}

export function buildDisplayed(options: {
  chatJid: string;
  kind: ChatKind;
  messageId: string;
}): XmppElement {
  return xml(
    'message',
    { type: options.kind, to: options.chatJid },
    xml('displayed', { xmlns: CHAT_MARKERS_NAMESPACE, id: options.messageId }),
  );
}

// XEP-0199: the keepalive ping sent to the server domain when the connection
// goes quiet, and the empty result sent back for an incoming server ping.
export function buildPingRequest(options: { id: string; to: string }): XmppElement {
  return xml(
    'iq',
    { type: 'get', id: options.id, to: options.to },
    xml('ping', { xmlns: PING_NAMESPACE }),
  );
}

export function buildPingResult(id: string, to?: string): XmppElement {
  const attrs: Record<string, string> = { type: 'result', id };
  if (to !== undefined) attrs['to'] = to;
  return xml('iq', attrs);
}

// XEP-0444: a body-less message carrying my complete reaction set for a target,
// with the store hint so the server archives it in MAM without a body.
export function buildReactions(options: {
  id: string;
  to: string;
  kind: ChatKind;
  targetId: string;
  emojis: string[];
}): XmppElement {
  const reactions = xml(
    'reactions',
    { xmlns: REACTIONS_NAMESPACE, id: options.targetId },
    ...sanitizeReactions(options.emojis).map((emoji) => xml('reaction', {}, emoji)),
  );
  return xml(
    'message',
    { type: options.kind, to: options.to, id: options.id },
    reactions,
    xml('store', { xmlns: HINTS_NAMESPACE }),
  );
}

export function buildJoinPresence(roomJid: string, nick: string): XmppElement {
  return xml(
    'presence',
    { to: `${roomJid}/${nick}` },
    // maxstanzas=0: history comes from MAM, not from the MUC join.
    xml('x', { xmlns: MUC_NAMESPACE }, xml('history', { maxstanzas: '0' })),
  );
}

export function buildLeavePresence(roomJid: string, nick: string): XmppElement {
  return xml(
    'presence',
    { to: `${roomJid}/${nick}`, type: 'unavailable' },
    xml('x', { xmlns: MUC_NAMESPACE }),
  );
}

export function buildAvailablePresence(): XmppElement {
  return xml('presence');
}

export function buildCarbonsEnable(id: string): XmppElement {
  return xml('iq', { type: 'set', id }, xml('enable', { xmlns: CARBONS_NAMESPACE }));
}

// XEP-0357: registers (enable) or removes (disable) this session's push pair
// with the app server. The browser must send it over its own XMPP session:
// ejabberd's `enable()` looks up the sender's session and answers
// `item-not-found` without one, so there is no admin-API shortcut.
export function buildPushEnable(options: {
  id: string;
  pushJid: string;
  node: string;
}): XmppElement {
  return xml(
    'iq',
    { type: 'set', id: options.id },
    xml('enable', { xmlns: PUSH_NAMESPACE, jid: options.pushJid, node: options.node }),
  );
}

export function buildPushDisable(options: {
  id: string;
  pushJid: string;
  node: string;
}): XmppElement {
  return xml(
    'iq',
    { type: 'set', id: options.id },
    xml('disable', { xmlns: PUSH_NAMESPACE, jid: options.pushJid, node: options.node }),
  );
}

// XEP-0363 §4: a slot request addressed to the upload service component.
export function buildUploadSlotRequest(options: {
  id: string;
  service: string;
  filename: string;
  size: number;
  contentType: string;
}): XmppElement {
  return xml(
    'iq',
    { type: 'get', id: options.id, to: options.service },
    xml('request', {
      xmlns: HTTP_UPLOAD_NAMESPACE,
      filename: options.filename,
      size: String(options.size),
      'content-type': options.contentType,
    }),
  );
}

// The slot response carries the PUT url (with headers) and the GET url.
export function parseUploadSlot(stanza: XmppElement): UploadSlot | undefined {
  const slot = stanza.getChild('slot', HTTP_UPLOAD_NAMESPACE);
  if (slot === undefined) return undefined;
  const putUrl = slot.getChild('put')?.attrs['url'];
  const getUrl = slot.getChild('get')?.attrs['url'];
  if (putUrl === undefined || putUrl === '' || getUrl === undefined || getUrl === '') {
    return undefined;
  }
  const headers: Record<string, string> = {};
  for (const header of slot.getChild('put')?.getChildren('header') ?? []) {
    const name = header.attrs['name'];
    if (name !== undefined && name !== '') {
      headers[name] = header.text();
    }
  }
  return { putUrl, getUrl, headers };
}

// RFC 6121 §2.1.6: a client acknowledges a roster push with an empty result.
export function buildRosterResult(id: string, to?: string): XmppElement {
  const attrs: Record<string, string> = { type: 'result', id };
  if (to !== undefined) attrs['to'] = to;
  return xml('iq', attrs);
}

// A roster push that did not come from our own server is rejected.
export function buildRosterError(id: string, to?: string): XmppElement {
  const attrs: Record<string, string> = { type: 'error', id };
  if (to !== undefined) attrs['to'] = to;
  return xml(
    'iq',
    attrs,
    xml('error', { type: 'auth' }, xml('forbidden', { xmlns: STANZA_NAMESPACE })),
  );
}
