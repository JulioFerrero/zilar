import { xml, type XmppElement } from '@xmpp/client';
import {
  AGENT_NAMESPACE,
  CARBONS_NAMESPACE,
  CHAT_MARKERS_NAMESPACE,
  CHAT_STATES_NAMESPACE,
  HINTS_NAMESPACE,
  HTTP_UPLOAD_NAMESPACE,
  MUC_NAMESPACE,
  PING_NAMESPACE,
  PUSH_NAMESPACE,
  REACTIONS_NAMESPACE,
  STANZA_NAMESPACE,
} from '../namespaces';
import type { ChatKind, UploadSlot } from '../types';
import { sanitizeReactions } from './reactions';

// ---------------------------------------------------------------------------
// Control stanzas
// ---------------------------------------------------------------------------

// T-1406: the AI's chat state may carry one short fixed status text (a stage
// like "Running tests"). It is capped so a caller can never send a paragraph,
// and it stays inside the body-less, non-stored chat-state message, so it
// leaves no trace in history.
export const MAX_STATUS_CHARS = 80;

function capStatus(status: string | undefined): string | undefined {
  if (status === undefined) {
    return undefined;
  }
  const capped = Array.from(status).slice(0, MAX_STATUS_CHARS).join('');
  return capped === '' ? undefined : capped;
}

export function buildTyping(options: {
  to: string;
  kind: ChatKind;
  state: 'composing' | 'paused' | 'active';
  status?: string;
}): XmppElement {
  const children: XmppElement[] = [xml(options.state, { xmlns: CHAT_STATES_NAMESPACE })];
  const status = capStatus(options.status);
  if (status !== undefined) {
    children.push(xml('stage', { xmlns: AGENT_NAMESPACE }, status));
  }
  return xml('message', { type: options.kind, to: options.to }, ...children);
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
