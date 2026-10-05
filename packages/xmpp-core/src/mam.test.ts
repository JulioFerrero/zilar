import { describe, expect, it } from 'vitest';
import { xml } from '@xmpp/client';
import { DATA_FORMS_NAMESPACE, MAM_NAMESPACE, RSM_NAMESPACE } from './namespaces';
import { buildMamQuery, orderOldestFirst, parseMamFin, toHistoryPage } from './mam';
import type { ChatMessage } from './types';

function message(id: string, timestamp: string, body: string): ChatMessage {
  return {
    id,
    chatJid: 'project@rooms.zilar.localhost',
    kind: 'groupchat',
    fromJid: 'alice@zilar.localhost',
    fromResolved: true,
    body,
    timestamp: new Date(timestamp),
    outgoing: false,
  };
}

describe('buildMamQuery', () => {
  it('queries a room archive with the max page size', () => {
    const iq = buildMamQuery({
      chatJid: 'project@rooms.zilar.localhost',
      kind: 'groupchat',
      me: 'bob@zilar.localhost',
      queryId: 'q1',
      iqId: 'iq-1',
      max: 50,
    });

    expect(iq.attrs).toMatchObject({
      type: 'set',
      id: 'iq-1',
      to: 'project@rooms.zilar.localhost',
    });
    const query = iq.getChild('query', MAM_NAMESPACE);
    expect(query?.attrs['queryid']).toBe('q1');
    expect(query?.getChild('set', RSM_NAMESPACE)?.getChildText('max')).toBe('50');
    // A room archive is not filtered by peer.
    expect(query?.getChild('x', DATA_FORMS_NAMESPACE)?.getChild('field')?.attrs['var']).toBe(
      'FORM_TYPE',
    );
  });

  it('queries a DM archive of my own account with <with>', () => {
    const iq = buildMamQuery({
      chatJid: 'alice@zilar.localhost',
      kind: 'chat',
      me: 'bob@zilar.localhost',
      queryId: 'q2',
      iqId: 'iq-2',
      max: 25,
    });

    expect(iq.attrs['to']).toBe('bob@zilar.localhost');
    const fields =
      iq
        .getChild('query', MAM_NAMESPACE)
        ?.getChild('x', DATA_FORMS_NAMESPACE)
        ?.getChildren('field') ?? [];
    const withField = fields.find((field) => field.attrs['var'] === 'with');
    expect(withField?.getChildText('value')).toBe('alice@zilar.localhost');
  });

  it('adds a before cursor when paging', () => {
    const iq = buildMamQuery({
      chatJid: 'project@rooms.zilar.localhost',
      kind: 'groupchat',
      me: 'bob@zilar.localhost',
      queryId: 'q3',
      iqId: 'iq-3',
      max: 50,
      before: 'archive-9',
    });
    expect(
      iq.getChild('query', MAM_NAMESPACE)?.getChild('set', RSM_NAMESPACE)?.getChildText('before'),
    ).toBe('archive-9');
  });
});

describe('parseMamFin', () => {
  it('reads complete and the first cursor', () => {
    const iq = xml(
      'iq',
      { type: 'result', id: 'iq-1' },
      xml(
        'fin',
        { xmlns: MAM_NAMESPACE, complete: 'true' },
        xml(
          'set',
          { xmlns: RSM_NAMESPACE },
          xml('first', {}, 'archive-1'),
          xml('last', {}, 'archive-5'),
        ),
      ),
    );
    expect(parseMamFin(iq)).toEqual({ complete: true, first: 'archive-1' });
  });

  it('reports incomplete when the server says there is more', () => {
    const iq = xml(
      'iq',
      { type: 'result', id: 'iq-2' },
      xml(
        'fin',
        { xmlns: MAM_NAMESPACE },
        xml('set', { xmlns: RSM_NAMESPACE }, xml('first', {}, 'a')),
      ),
    );
    expect(parseMamFin(iq)).toEqual({ complete: false, first: 'a' });
  });

  it('tolerates an iq without a fin element', () => {
    expect(parseMamFin(xml('iq', { type: 'result', id: 'iq-3' }))).toEqual({ complete: false });
  });
});

describe('orderOldestFirst', () => {
  it('leaves an ascending page unchanged', () => {
    const messages = [
      message('a', '2026-09-27T10:00:00Z', 'one'),
      message('b', '2026-09-27T10:01:00Z', 'two'),
    ];
    expect(orderOldestFirst(messages).map((entry) => entry.body)).toEqual(['one', 'two']);
  });

  it('reverses a descending page', () => {
    const messages = [
      message('b', '2026-09-27T10:01:00Z', 'two'),
      message('a', '2026-09-27T10:00:00Z', 'one'),
    ];
    expect(orderOldestFirst(messages).map((entry) => entry.body)).toEqual(['one', 'two']);
  });

  it('leaves a single message alone', () => {
    const messages = [message('a', '2026-09-27T10:00:00Z', 'one')];
    expect(orderOldestFirst(messages)).toBe(messages);
  });
});

describe('toHistoryPage', () => {
  it('orders the messages and keeps the cursor only when present', () => {
    const messages = [
      message('b', '2026-09-27T10:01:00Z', 'two'),
      message('a', '2026-09-27T10:00:00Z', 'one'),
    ];
    expect(toHistoryPage(messages, { complete: true, first: 'a' })).toEqual({
      messages: [messages[1], messages[0]],
      complete: true,
      first: 'a',
    });
    expect(toHistoryPage(messages, { complete: false })).not.toHaveProperty('first');
  });
});
