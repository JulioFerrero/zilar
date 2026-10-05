import { xml, type XmppElement } from '@xmpp/client';
import { DATA_FORMS_NAMESPACE, MAM_NAMESPACE, RSM_NAMESPACE } from './namespaces';
import type { ChatKind, ChatMessage, HistoryPage } from './types';

export const DEFAULT_HISTORY_MAX = 50;

export type MamQuery = {
  chatJid: string;
  kind: ChatKind;
  me: string;
  queryId: string;
  iqId: string;
  max: number;
  before?: string | undefined;
};

export function buildMamQuery(query: MamQuery): XmppElement {
  const fields: XmppElement[] = [
    xml('field', { var: 'FORM_TYPE', type: 'hidden' }, xml('value', {}, MAM_NAMESPACE)),
  ];
  if (query.kind === 'chat') {
    // A DM archive is queried with `with=<peer>`; a room archive is the room's own.
    fields.push(xml('field', { var: 'with' }, xml('value', {}, query.chatJid)));
  }

  const rsm: XmppElement[] = [xml('max', {}, String(query.max))];
  if (query.before !== undefined) {
    rsm.push(xml('before', {}, query.before));
  }

  return xml(
    'iq',
    {
      type: 'set',
      id: query.iqId,
      to: query.kind === 'groupchat' ? query.chatJid : query.me,
    },
    xml(
      'query',
      { xmlns: MAM_NAMESPACE, queryid: query.queryId },
      xml('x', { xmlns: DATA_FORMS_NAMESPACE, type: 'submit' }, ...fields),
      xml('set', { xmlns: RSM_NAMESPACE }, ...rsm),
    ),
  );
}

export type MamFin = {
  complete: boolean;
  first?: string;
};

export function parseMamFin(iq: XmppElement): MamFin {
  const fin = iq.getChild('fin', MAM_NAMESPACE);
  if (fin === undefined) {
    return { complete: false };
  }

  const complete = fin.attrs['complete'] === 'true' || fin.getChild('complete') !== undefined;
  const first = fin.getChild('set', RSM_NAMESPACE)?.getChildText('first');
  if (first === null || first === undefined || first === '') {
    return { complete };
  }
  return { complete, first };
}

export function toHistoryPage(messages: ChatMessage[], fin: MamFin): HistoryPage {
  const page: HistoryPage = { messages: orderOldestFirst(messages), complete: fin.complete };
  if (fin.first !== undefined) {
    page.first = fin.first;
  }
  return page;
}

// MAM returns a page in chronological order on most servers, but the XEP lets a
// server answer newest-first. Detect that from the timestamps and reverse so the
// caller always gets oldest first.
export function orderOldestFirst(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length < 2) {
    return messages;
  }
  const first = messages[0]!.timestamp.getTime();
  const last = messages[messages.length - 1]!.timestamp.getTime();
  return first > last ? [...messages].reverse() : messages;
}
