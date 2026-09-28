import { describe, expect, it } from 'vitest';
import { xml, type XmppElement } from '@xmpp/client';
import { encodePayload, type Payload } from '@galena/protocol';
import {
  buildCarbonsEnable,
  buildDisplayed,
  buildJoinPresence,
  buildLeavePresence,
  buildMessage,
  buildReactions,
  buildTyping,
  buildUploadSlotRequest,
  decodeMessageStanza,
  isMamResult,
  mamResultQueryId,
  parseReactions,
  parseUploadSlot,
  sanitizeReactions,
  type ParseContext,
} from './stanza';
import { MAX_BODY_BYTES, capBody, utf8ByteLength } from './text';
import {
  AGENT_NAMESPACE,
  CARBONS_NAMESPACE,
  CHAT_MARKERS_NAMESPACE,
  CHAT_STATES_NAMESPACE,
  DELAY_NAMESPACE,
  FORWARD_NAMESPACE,
  HINTS_NAMESPACE,
  HTTP_UPLOAD_NAMESPACE,
  MAM_NAMESPACE,
  MUC_NAMESPACE,
  MUC_USER_NAMESPACE,
  REACTIONS_NAMESPACE,
  REFERENCE_NAMESPACE,
  REPLY_NAMESPACE,
  STANZA_ID_NAMESPACE,
} from './namespaces';

const ctx: ParseContext = {
  me: 'bob@galena.localhost',
  domain: 'galena.localhost',
  mucDomain: 'rooms.galena.localhost',
  now: () => new Date('2026-09-27T12:00:00.000Z'),
};

const progress: Payload = {
  v: 0,
  type: 'progress',
  data: { ai: 'dev-1@galena.localhost', stage: 'running the tests', percent: 40 },
};

function mucUser(jid: string, extras: Record<string, string> = {}): XmppElement {
  return xml('x', { xmlns: MUC_USER_NAMESPACE }, xml('item', { jid, ...extras }));
}

describe('buildMessage', () => {
  it('sets the type, id, recipient, body, payload and reply', () => {
    const stanza = buildMessage({
      id: 'm-1',
      to: 'project@rooms.galena.localhost',
      kind: 'groupchat',
      text: 'hello room',
      payload: progress,
      replyTo: { id: 'm-0', to: 'alice@galena.localhost' },
    });

    expect(stanza.is('message')).toBe(true);
    expect(stanza.attrs).toMatchObject({
      type: 'groupchat',
      to: 'project@rooms.galena.localhost',
      id: 'm-1',
    });
    expect(stanza.getChildText('body')).toBe('hello room');

    const agent = stanza.getChild('agent', AGENT_NAMESPACE);
    expect(agent?.text()).toBe(encodePayload(progress));

    const reply = stanza.getChild('reply', REPLY_NAMESPACE);
    expect(reply?.attrs['id']).toBe('m-0');
    expect(reply?.attrs['to']).toBe('alice@galena.localhost');
  });

  it('omits the payload and reply elements when they are not given', () => {
    const stanza = buildMessage({
      id: 'm-2',
      to: 'alice@galena.localhost',
      kind: 'chat',
      text: 'hi',
    });
    expect(stanza.getChild('agent', AGENT_NAMESPACE)).toBeUndefined();
    expect(stanza.getChild('reply', REPLY_NAMESPACE)).toBeUndefined();
  });
});

describe('buildTyping, buildDisplayed, presence and carbons', () => {
  it('builds a composing chat state addressed to the conversation', () => {
    const stanza = buildTyping({
      to: 'project@rooms.galena.localhost',
      kind: 'groupchat',
      state: 'composing',
    });
    expect(stanza.attrs).toMatchObject({ type: 'groupchat', to: 'project@rooms.galena.localhost' });
    expect(stanza.getChild('composing', CHAT_STATES_NAMESPACE)).toBeDefined();
  });

  it('builds a displayed marker for a message id', () => {
    const stanza = buildDisplayed({
      chatJid: 'alice@galena.localhost',
      kind: 'chat',
      messageId: 'm-9',
    });
    const displayed = stanza.getChild('displayed', CHAT_MARKERS_NAMESPACE);
    expect(displayed?.attrs['id']).toBe('m-9');
  });

  it('asks for no MUC history when joining', () => {
    const stanza = buildJoinPresence('project@rooms.galena.localhost', 'bob');
    expect(stanza.attrs).toMatchObject({
      to: 'project@rooms.galena.localhost/bob',
    });
    const history = stanza.getChild('x', MUC_NAMESPACE)?.getChild('history');
    expect(history?.attrs['maxstanzas']).toBe('0');
  });

  it('leaves with an unavailable presence', () => {
    const stanza = buildLeavePresence('project@rooms.galena.localhost', 'bob');
    expect(stanza.attrs['type']).toBe('unavailable');
  });

  it('enables carbons with an iq', () => {
    const stanza = buildCarbonsEnable('iq-1');
    expect(stanza.attrs).toMatchObject({ type: 'set', id: 'iq-1' });
    expect(stanza.getChild('enable', CARBONS_NAMESPACE)).toBeDefined();
  });
});

describe('buildUploadSlotRequest and parseUploadSlot', () => {
  it('asks the upload service for a slot with the file details', () => {
    const stanza = buildUploadSlotRequest({
      id: 'iq-up-1',
      service: 'upload.galena.localhost',
      filename: 'voice.m4a',
      size: 4096,
      contentType: 'audio/mp4',
    });
    expect(stanza.attrs).toMatchObject({
      type: 'get',
      id: 'iq-up-1',
      to: 'upload.galena.localhost',
    });
    const request = stanza.getChild('request', HTTP_UPLOAD_NAMESPACE);
    expect(request?.attrs).toMatchObject({
      filename: 'voice.m4a',
      size: '4096',
      'content-type': 'audio/mp4',
    });
  });

  it('parses the put and get urls with the put headers', () => {
    const reply = xml(
      'iq',
      { type: 'result', id: 'iq-up-1' },
      xml(
        'slot',
        { xmlns: HTTP_UPLOAD_NAMESPACE },
        xml(
          'put',
          { url: 'https://upload.example.com/put/abc' },
          xml('header', { name: 'X-Token' }, 'secret'),
        ),
        xml('get', { url: 'https://upload.example.com/get/abc' }),
      ),
    );
    expect(parseUploadSlot(reply)).toEqual({
      putUrl: 'https://upload.example.com/put/abc',
      getUrl: 'https://upload.example.com/get/abc',
      headers: { 'X-Token': 'secret' },
    });
  });

  it('returns undefined when the reply is not a slot', () => {
    expect(parseUploadSlot(xml('iq', { type: 'result', id: 'iq-up-2' }))).toBeUndefined();
  });
});

describe('decodeMessageStanza: live messages', () => {
  it('parses a groupchat message with the real sender JID', () => {
    const stanza = xml(
      'message',
      {
        from: 'project@rooms.galena.localhost/alice',
        to: 'bob@galena.localhost',
        type: 'groupchat',
        id: 'm-1',
      },
      xml('body', {}, 'hello room'),
      mucUser('alice@galena.localhost'),
    );

    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message).toMatchObject({
      id: 'm-1',
      chatJid: 'project@rooms.galena.localhost',
      kind: 'groupchat',
      fromJid: 'alice@galena.localhost',
      fromNick: 'alice',
      body: 'hello room',
      outgoing: false,
    });
    expect(message?.timestamp.toISOString()).toBe('2026-09-27T12:00:00.000Z');
  });

  it('marks my own room reflection as outgoing via the item JID', () => {
    const stanza = xml(
      'message',
      { from: 'project@rooms.galena.localhost/bob', type: 'groupchat', id: 'm-2' },
      xml('body', {}, 'mine'),
      mucUser('bob@galena.localhost', { affiliation: 'owner', role: 'moderator' }),
    );
    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.outgoing).toBe(true);
    expect(message?.fromJid).toBe('bob@galena.localhost');
  });

  it('parses a DM with the peer as the conversation', () => {
    const stanza = xml(
      'message',
      {
        from: 'alice@galena.localhost/phone',
        to: 'bob@galena.localhost/laptop',
        type: 'chat',
        id: 'm-3',
      },
      xml('body', {}, 'hi bob'),
    );
    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message).toMatchObject({
      id: 'm-3',
      chatJid: 'alice@galena.localhost',
      kind: 'chat',
      fromJid: 'alice@galena.localhost',
      body: 'hi bob',
      outgoing: false,
    });
  });

  it('parses a sent carbon and marks it outgoing', () => {
    const stanza = xml(
      'message',
      { from: 'bob@galena.localhost/laptop', to: 'bob@galena.localhost/laptop', type: 'chat' },
      xml(
        'sent',
        { xmlns: CARBONS_NAMESPACE },
        xml(
          'forwarded',
          { xmlns: FORWARD_NAMESPACE },
          xml(
            'message',
            {
              from: 'bob@galena.localhost/phone',
              to: 'alice@galena.localhost',
              type: 'chat',
              id: 'm-4',
            },
            xml('body', {}, 'from my phone'),
          ),
        ),
      ),
    );
    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message).toMatchObject({
      id: 'm-4',
      chatJid: 'alice@galena.localhost',
      fromJid: 'bob@galena.localhost',
      body: 'from my phone',
      outgoing: true,
    });
  });

  it('parses a received carbon', () => {
    const stanza = xml(
      'message',
      { from: 'bob@galena.localhost/laptop', to: 'bob@galena.localhost/laptop', type: 'chat' },
      xml(
        'received',
        { xmlns: CARBONS_NAMESPACE },
        xml(
          'forwarded',
          { xmlns: FORWARD_NAMESPACE },
          xml(
            'message',
            {
              from: 'alice@galena.localhost/phone',
              to: 'bob@galena.localhost',
              type: 'chat',
              id: 'm-5',
            },
            xml('body', {}, 'to all my devices'),
          ),
        ),
      ),
    );
    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message).toMatchObject({
      chatJid: 'alice@galena.localhost',
      fromJid: 'alice@galena.localhost',
      body: 'to all my devices',
      outgoing: false,
    });
  });

  it('reads the timestamp from a delay element', () => {
    const stanza = xml(
      'message',
      { from: 'alice@galena.localhost', to: 'bob@galena.localhost', type: 'chat', id: 'm-6' },
      xml('body', {}, 'delayed'),
      xml('delay', { xmlns: DELAY_NAMESPACE, stamp: '2026-09-26T08:30:00.000Z' }),
    );
    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.timestamp.toISOString()).toBe('2026-09-26T08:30:00.000Z');
  });
});

describe('decodeMessageStanza: payloads', () => {
  it('decodes a valid payload', () => {
    const stanza = xml(
      'message',
      { from: 'dev-1@galena.localhost', to: 'bob@galena.localhost', type: 'chat', id: 'm-7' },
      xml('body', {}, 'starting'),
      xml('agent', { xmlns: AGENT_NAMESPACE }, encodePayload(progress)),
    );
    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.payload).toEqual(progress);
    expect(message?.body).toBe('starting');
  });

  it('drops an invalid payload but keeps the body', () => {
    const stanza = xml(
      'message',
      { from: 'dev-1@galena.localhost', type: 'chat', id: 'm-8' },
      xml('body', {}, 'still readable'),
      xml('agent', { xmlns: AGENT_NAMESPACE }, 'not json at all'),
    );
    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.payload).toBeUndefined();
    expect(message?.body).toBe('still readable');
  });

  it('drops an oversized payload but keeps the body', () => {
    const oversized = JSON.stringify({
      v: 0,
      type: 'progress',
      data: { ai: 'dev-1@galena.localhost', stage: 'x'.repeat(70 * 1024) },
    });
    const stanza = xml(
      'message',
      { from: 'dev-1@galena.localhost', type: 'chat', id: 'm-9' },
      xml('body', {}, 'big one'),
      xml('agent', { xmlns: AGENT_NAMESPACE }, oversized),
    );
    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.payload).toBeUndefined();
    expect(message?.body).toBe('big one');
  });

  it('accepts a payload-only message and a body-only message', () => {
    const withPayload = xml(
      'message',
      { from: 'dev-1@galena.localhost', type: 'chat', id: 'm-10' },
      xml('agent', { xmlns: AGENT_NAMESPACE }, encodePayload(progress)),
    );
    expect(decodeMessageStanza(withPayload, ctx).message?.payload).toEqual(progress);

    const withoutAgent = xml(
      'message',
      { from: 'dev-1@galena.localhost', type: 'chat', id: 'm-11' },
      xml('body', {}, 'no payload'),
    );
    expect(decodeMessageStanza(withoutAgent, ctx).message?.payload).toBeUndefined();
  });
});

describe('decodeMessageStanza: replies, typing and displayed', () => {
  it('parses a reply', () => {
    const stanza = xml(
      'message',
      { from: 'alice@galena.localhost', type: 'chat', id: 'm-12' },
      xml('body', {}, 'replying'),
      xml('reply', { xmlns: REPLY_NAMESPACE, id: 'm-1', to: 'bob@galena.localhost' }),
    );
    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.replyTo).toEqual({ id: 'm-1', to: 'bob@galena.localhost' });
  });

  it('parses every typing state without producing a message', () => {
    for (const state of ['composing', 'paused', 'active'] as const) {
      const stanza = xml(
        'message',
        { from: 'alice@galena.localhost', to: 'bob@galena.localhost', type: 'chat' },
        xml(state, { xmlns: CHAT_STATES_NAMESPACE }),
      );
      const decoded = decodeMessageStanza(stanza, ctx);
      expect(decoded.message).toBeUndefined();
      expect(decoded.typing).toEqual({
        chatJid: 'alice@galena.localhost',
        fromJid: 'alice@galena.localhost',
        state,
        outgoing: false,
      });
    }
  });

  it('parses a displayed marker', () => {
    const stanza = xml(
      'message',
      { from: 'alice@galena.localhost', to: 'bob@galena.localhost', type: 'chat' },
      xml('displayed', { xmlns: CHAT_MARKERS_NAMESPACE, id: 'm-1' }),
    );
    const decoded = decodeMessageStanza(stanza, ctx);
    expect(decoded.message).toBeUndefined();
    expect(decoded.displayed).toEqual({
      chatJid: 'alice@galena.localhost',
      fromJid: 'alice@galena.localhost',
      messageId: 'm-1',
      outgoing: false,
    });
  });
});

describe('decodeMessageStanza: domain filter', () => {
  it('ignores messages from another domain', () => {
    const stanza = xml(
      'message',
      { from: 'alice@evil.example.com', to: 'bob@galena.localhost', type: 'chat', id: 'm-13' },
      xml('body', {}, 'phishing'),
    );
    expect(decodeMessageStanza(stanza, ctx).message).toBeUndefined();
  });

  it('ignores a groupchat message from a non-room domain', () => {
    const stanza = xml(
      'message',
      { from: 'project@rooms.evil.example.com/alice', type: 'groupchat', id: 'm-14' },
      xml('body', {}, 'not our room'),
      mucUser('alice@evil.example.com'),
    );
    expect(decodeMessageStanza(stanza, ctx).message).toBeUndefined();
  });

  it('ignores a chat message that claims to come from the room domain', () => {
    const stanza = xml(
      'message',
      { from: 'room@rooms.galena.localhost', type: 'chat', id: 'm-15' },
      xml('body', {}, 'wrong kind'),
    );
    expect(decodeMessageStanza(stanza, ctx).message).toBeUndefined();
  });
});

describe('decodeMessageStanza: archived results', () => {
  function archived(options: {
    queryId: string;
    archiveId: string;
    withStanzaId?: boolean;
  }): XmppElement {
    const inner = xml(
      'message',
      { from: 'project@rooms.galena.localhost/alice', type: 'groupchat', id: 'm-16' },
      xml('body', {}, 'archived'),
      mucUser('alice@galena.localhost'),
    );
    if (options.withStanzaId === true) {
      inner.children.push(
        xml('stanza-id', {
          xmlns: STANZA_ID_NAMESPACE,
          by: 'project@rooms.galena.localhost',
          id: 'sid-1',
        }),
      );
    }
    return xml(
      'message',
      { from: 'project@rooms.galena.localhost', to: 'bob@galena.localhost/laptop' },
      xml(
        'result',
        { xmlns: MAM_NAMESPACE, queryid: options.queryId, id: options.archiveId },
        xml(
          'forwarded',
          { xmlns: FORWARD_NAMESPACE },
          xml('delay', { xmlns: DELAY_NAMESPACE, stamp: '2026-09-26T07:00:00.000Z' }),
          inner,
        ),
      ),
    );
  }

  it('recognises a MAM result and reads its query id', () => {
    const stanza = archived({ queryId: 'q1', archiveId: 'archive-1' });
    expect(isMamResult(stanza)).toBe(true);
    expect(mamResultQueryId(stanza)).toBe('q1');
  });

  it('parses the forwarded message and uses the archive id', () => {
    const { message } = decodeMessageStanza(
      archived({ queryId: 'q1', archiveId: 'archive-1' }),
      ctx,
    );
    expect(message).toMatchObject({
      id: 'archive-1',
      chatJid: 'project@rooms.galena.localhost',
      fromJid: 'alice@galena.localhost',
      body: 'archived',
    });
    expect(message?.timestamp.toISOString()).toBe('2026-09-26T07:00:00.000Z');
  });

  it('prefers the archive stanza-id over the result id', () => {
    const stanza = archived({ queryId: 'q1', archiveId: 'archive-1', withStanzaId: true });
    expect(decodeMessageStanza(stanza, ctx).message?.id).toBe('sid-1');
  });
});

describe('decodeMessageStanza: XEP-0372 mentions', () => {
  function reference(attrs: Record<string, string>): XmppElement {
    return xml('reference', { xmlns: REFERENCE_NAMESPACE, ...attrs });
  }

  it('builds one reference per mention with code-point offsets', () => {
    const stanza = buildMessage({
      id: 'm-20',
      to: 'project@rooms.galena.localhost',
      kind: 'groupchat',
      text: 'hi 😀 @Ana and @Luis',
      mentions: [
        { jid: 'ana@galena.localhost', begin: 6, end: 10 },
        { jid: 'luis@galena.localhost', begin: 15, end: 20 },
      ],
    });

    const references = stanza.getChildren('reference', REFERENCE_NAMESPACE);
    expect(references).toHaveLength(2);
    // The emoji is one code point, so each offset is two lower than the UTF-16
    // index the caller passed.
    expect(references[0]?.attrs).toMatchObject({
      type: 'mention',
      uri: 'xmpp:ana@galena.localhost',
      begin: '5',
      end: '9',
    });
    expect(references[1]?.attrs).toMatchObject({
      type: 'mention',
      uri: 'xmpp:luis@galena.localhost',
      begin: '14',
      end: '19',
    });
  });

  it('builds no references without mentions', () => {
    const stanza = buildMessage({
      id: 'm-21',
      to: 'project@rooms.galena.localhost',
      kind: 'groupchat',
      text: 'plain',
    });
    expect(stanza.getChildren('reference', REFERENCE_NAMESPACE)).toHaveLength(0);
  });

  it('skips invalid ranges and caps at twenty mentions', () => {
    const text = 'hi there';
    const invalid = [
      { jid: 'a@galena.localhost', begin: -1, end: 2 },
      { jid: 'b@galena.localhost', begin: 2, end: 2 },
      { jid: 'c@galena.localhost', begin: 5, end: 3 },
      { jid: 'd@galena.localhost', begin: 0, end: text.length + 1 },
      { jid: 'e@galena.localhost', begin: 1.5, end: 3 },
    ];
    const valid = Array.from({ length: 25 }, (_, index) => ({
      jid: `u${index}@galena.localhost`,
      begin: 0,
      end: 2,
    }));
    const stanza = buildMessage({
      id: 'm-29',
      to: 'project@rooms.galena.localhost',
      kind: 'groupchat',
      text,
      mentions: [...invalid, ...valid],
    });

    const references = stanza.getChildren('reference', REFERENCE_NAMESPACE);
    expect(references).toHaveLength(20);
    expect(references[0]?.attrs['uri']).toBe('xmpp:u0@galena.localhost');
    expect(references[19]?.attrs['uri']).toBe('xmpp:u19@galena.localhost');
  });

  it('round trips mentions through build and parse', () => {
    const built = buildMessage({
      id: 'm-22',
      to: 'project@rooms.galena.localhost',
      kind: 'groupchat',
      text: 'hi 😀 @Ana',
      mentions: [{ jid: 'ana@galena.localhost', begin: 6, end: 10 }],
    });
    const stanza = xml(
      'message',
      {
        from: 'project@rooms.galena.localhost/alice',
        to: 'bob@galena.localhost',
        type: 'groupchat',
        id: 'm-22',
      },
      ...built.children,
      mucUser('alice@galena.localhost'),
    );

    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.mentions).toEqual([{ jid: 'ana@galena.localhost', begin: 6, end: 10 }]);
  });

  it('parses a mention and lowers the bare JID, dropping resource and query', () => {
    const stanza = xml(
      'message',
      { from: 'alice@galena.localhost', type: 'chat', id: 'm-23' },
      xml('body', {}, 'hey @Ana'),
      reference({
        type: 'mention',
        uri: 'xmpp:ANA@Galena.Localhost/resource?query=1',
        begin: '4',
        end: '8',
      }),
    );
    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.mentions).toEqual([{ jid: 'ana@galena.localhost', begin: 4, end: 8 }]);
  });

  it('keeps the JID and drops out-of-range or reversed offsets', () => {
    const cases: Array<Record<string, string>> = [
      { begin: '3', end: '3' },
      { begin: '9', end: '20' },
      { begin: 'x', end: '8' },
      { begin: '4' },
    ];
    for (const offsets of cases) {
      const stanza = xml(
        'message',
        { from: 'alice@galena.localhost', type: 'chat', id: 'm-24' },
        xml('body', {}, 'hey @Ana'),
        reference({ type: 'mention', uri: 'xmpp:ana@galena.localhost', ...offsets }),
      );
      const { message } = decodeMessageStanza(stanza, ctx);
      expect(message?.mentions).toEqual([{ jid: 'ana@galena.localhost' }]);
    }
  });

  it('drops a bad URI, a non-xmpp URI and a wrong reference type', () => {
    const stanza = xml(
      'message',
      { from: 'alice@galena.localhost', type: 'chat', id: 'm-25' },
      xml('body', {}, 'hey'),
      reference({ type: 'mention', uri: 'xmpp:not-a-jid', begin: '0', end: '3' }),
      reference({ type: 'mention', uri: 'https://example.com', begin: '0', end: '3' }),
      reference({ type: 'reply', uri: 'xmpp:ana@galena.localhost', begin: '0', end: '3' }),
    );
    expect(decodeMessageStanza(stanza, ctx).message?.mentions).toBeUndefined();
  });

  it('caps a message at twenty mentions', () => {
    const references = Array.from({ length: 25 }, (_, index) =>
      reference({ type: 'mention', uri: `xmpp:u${index}@galena.localhost` }),
    );
    const stanza = xml(
      'message',
      { from: 'alice@galena.localhost', type: 'chat', id: 'm-26' },
      xml('body', {}, 'many'),
      ...references,
    );
    const mentions = decodeMessageStanza(stanza, ctx).message?.mentions ?? [];
    expect(mentions).toHaveLength(20);
    expect(mentions[0]?.jid).toBe('u0@galena.localhost');
    expect(mentions[19]?.jid).toBe('u19@galena.localhost');
  });

  it('parses mentions inside a forwarded carbon', () => {
    const stanza = xml(
      'message',
      { from: 'bob@galena.localhost/laptop', type: 'chat' },
      xml(
        'received',
        { xmlns: CARBONS_NAMESPACE },
        xml(
          'forwarded',
          { xmlns: FORWARD_NAMESPACE },
          xml(
            'message',
            {
              from: 'alice@galena.localhost',
              to: 'bob@galena.localhost',
              type: 'chat',
              id: 'm-27',
            },
            xml('body', {}, 'hey @Ana'),
            reference({ type: 'mention', uri: 'xmpp:ana@galena.localhost', begin: '4', end: '8' }),
          ),
        ),
      ),
    );
    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.mentions).toEqual([{ jid: 'ana@galena.localhost', begin: 4, end: 8 }]);
  });

  it('parses mentions inside a MAM result', () => {
    const inner = xml(
      'message',
      { from: 'project@rooms.galena.localhost/alice', type: 'groupchat', id: 'm-28' },
      xml('body', {}, 'hey @Ana'),
      reference({ type: 'mention', uri: 'xmpp:ana@galena.localhost', begin: '4', end: '8' }),
      mucUser('alice@galena.localhost'),
    );
    const stanza = xml(
      'message',
      { from: 'project@rooms.galena.localhost', to: 'bob@galena.localhost/laptop' },
      xml(
        'result',
        { xmlns: MAM_NAMESPACE, queryid: 'q1', id: 'archive-1' },
        xml(
          'forwarded',
          { xmlns: FORWARD_NAMESPACE },
          xml('delay', { xmlns: DELAY_NAMESPACE, stamp: '2026-09-26T07:00:00.000Z' }),
          inner,
        ),
      ),
    );
    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.mentions).toEqual([{ jid: 'ana@galena.localhost', begin: 4, end: 8 }]);
  });
});

describe('decodeMessageStanza: hostile input', () => {
  const malformed: Array<[string, XmppElement]> = [
    ['a message with no attributes', xml('message')],
    [
      'a from that is not a JID',
      xml('message', { from: 'not-a-jid', type: 'chat' }, xml('body', {}, 'x')),
    ],
    [
      'an empty body element',
      xml('message', { from: 'alice@galena.localhost', type: 'chat' }, xml('body')),
    ],
    [
      'an unparseable payload',
      xml(
        'message',
        { from: 'alice@galena.localhost', type: 'chat' },
        xml('body', {}, 'x'),
        xml('agent', { xmlns: AGENT_NAMESPACE }, '{"v":0,"type":"task","data":{}}'),
      ),
    ],
    [
      'a MUC user element without an item',
      xml(
        'message',
        { from: 'project@rooms.galena.localhost', type: 'groupchat' },
        xml('x', { xmlns: MUC_USER_NAMESPACE }),
      ),
    ],
    [
      'a MAM result without a forwarded element',
      xml(
        'message',
        { from: 'project@rooms.galena.localhost' },
        xml('result', { xmlns: MAM_NAMESPACE, queryid: 'q' }),
      ),
    ],
    [
      'a reply without an id',
      xml(
        'message',
        { from: 'alice@galena.localhost', type: 'chat' },
        xml('body', {}, 'x'),
        xml('reply', { xmlns: REPLY_NAMESPACE }),
      ),
    ],
  ];

  it.each(malformed)('never throws on %s', (_label, stanza) => {
    expect(() => decodeMessageStanza(stanza, ctx)).not.toThrow();
  });

  it('caps a 70 KiB body at 64 KiB', () => {
    const stanza = xml(
      'message',
      { from: 'alice@galena.localhost', type: 'chat' },
      xml('body', {}, 'a'.repeat(70 * 1024)),
    );
    const body = decodeMessageStanza(stanza, ctx).message?.body ?? '';
    expect(utf8ByteLength(body)).toBeLessThanOrEqual(MAX_BODY_BYTES);
  });

  it('caps a multi-byte body without splitting a code point', () => {
    const capped = capBody('😀'.repeat(20 * 1024));
    expect(utf8ByteLength(capped)).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(capped).not.toContain('\uFFFD');
    expect([...capped].every((character) => character === '😀')).toBe(true);
  });
});

describe('XEP-0444 reactions', () => {
  function reactionUpdate(targetId: string, emojis: string[]): XmppElement {
    return xml(
      'reactions',
      { xmlns: REACTIONS_NAMESPACE, id: targetId },
      ...emojis.map((emoji) => xml('reaction', {}, emoji)),
    );
  }

  it('builds a body-less reactions message with the store hint', () => {
    const stanza = buildReactions({
      id: 'm-r1',
      to: 'project@rooms.galena.localhost',
      kind: 'groupchat',
      targetId: 'sid-1',
      emojis: ['👍', '❤️'],
    });

    expect(stanza.attrs).toMatchObject({
      type: 'groupchat',
      to: 'project@rooms.galena.localhost',
      id: 'm-r1',
    });
    expect(stanza.getChild('body')).toBeUndefined();
    const reactions = stanza.getChild('reactions', REACTIONS_NAMESPACE);
    expect(reactions?.attrs['id']).toBe('sid-1');
    expect(reactions?.getChildren('reaction').map((element) => element.text())).toEqual([
      '👍',
      '❤️',
    ]);
    expect(stanza.getChild('store', HINTS_NAMESPACE)).toBeDefined();
  });

  it('builds an empty element that clears my set', () => {
    const stanza = buildReactions({
      id: 'm-r2',
      to: 'alice@galena.localhost',
      kind: 'chat',
      targetId: 'm-1',
      emojis: [],
    });
    const reactions = stanza.getChild('reactions', REACTIONS_NAMESPACE);
    expect(reactions?.attrs['id']).toBe('m-1');
    expect(reactions?.getChildren('reaction')).toHaveLength(0);
    expect(stanza.getChild('store', HINTS_NAMESPACE)).toBeDefined();
  });

  it('drops non-emoji, dedupes and caps the set at six', () => {
    expect(
      sanitizeReactions(['👍', 'hello', '👍', '😀', '😂', '😮', '😢', '🙏', '❤️', '1']),
    ).toEqual(['👍', '😀', '😂', '😮', '😢', '🙏']);

    const stanza = buildReactions({
      id: 'm-r3',
      to: 'alice@galena.localhost',
      kind: 'chat',
      targetId: 'm-1',
      emojis: ['nope', '👍'],
    });
    const reactions = stanza.getChild('reactions', REACTIONS_NAMESPACE);
    expect(reactions?.getChildren('reaction').map((element) => element.text())).toEqual(['👍']);
  });

  it('parses a body-less reaction update with its target', () => {
    const stanza = xml(
      'message',
      { from: 'alice@galena.localhost', to: 'bob@galena.localhost', type: 'chat', id: 'm-30' },
      reactionUpdate('m-1', ['👍']),
      xml('store', { xmlns: HINTS_NAMESPACE }),
    );

    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.body).toBeUndefined();
    expect(message?.payload).toBeUndefined();
    expect(message?.reactions).toEqual({ targetId: 'm-1', emojis: ['👍'] });
  });

  it('parses an empty element as a clear', () => {
    expect(parseReactions(xml('message', {}, reactionUpdate('m-1', [])))).toEqual({
      targetId: 'm-1',
      emojis: [],
    });
  });

  it('drops invalid reactions and caps the parsed set at six', () => {
    const stanza = xml(
      'message',
      { from: 'alice@galena.localhost', type: 'chat', id: 'm-31' },
      reactionUpdate('m-2', ['hi', '👍', '👍', '😀', '😂', '😮', '😢', '🙏', '❤️']),
    );
    expect(decodeMessageStanza(stanza, ctx).message?.reactions).toEqual({
      targetId: 'm-2',
      emojis: ['👍', '😀', '😂', '😮', '😢', '🙏'],
    });
  });

  it('ignores a reactions element without a target id', () => {
    const stanza = xml(
      'message',
      { from: 'alice@galena.localhost', type: 'chat', id: 'm-32' },
      xml('reactions', { xmlns: REACTIONS_NAMESPACE }, xml('reaction', {}, '👍')),
    );
    expect(parseReactions(stanza)).toBeUndefined();
    expect(decodeMessageStanza(stanza, ctx).message).toBeUndefined();
  });

  it('parses reactions inside a received carbon', () => {
    const stanza = xml(
      'message',
      { from: 'bob@galena.localhost/laptop', to: 'bob@galena.localhost/laptop', type: 'chat' },
      xml(
        'received',
        { xmlns: CARBONS_NAMESPACE },
        xml(
          'forwarded',
          { xmlns: FORWARD_NAMESPACE },
          xml(
            'message',
            {
              from: 'alice@galena.localhost',
              to: 'bob@galena.localhost',
              type: 'chat',
              id: 'm-33',
            },
            reactionUpdate('m-1', ['👍']),
          ),
        ),
      ),
    );

    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.reactions).toEqual({ targetId: 'm-1', emojis: ['👍'] });
  });

  it('parses a group reaction inside a MAM result by its target id', () => {
    const inner = xml(
      'message',
      { from: 'project@rooms.galena.localhost/alice', type: 'groupchat', id: 'm-34' },
      reactionUpdate('sid-1', ['❤️']),
      mucUser('alice@galena.localhost'),
    );
    const stanza = xml(
      'message',
      { from: 'project@rooms.galena.localhost', to: 'bob@galena.localhost/laptop' },
      xml(
        'result',
        { xmlns: MAM_NAMESPACE, queryid: 'q1', id: 'archive-2' },
        xml(
          'forwarded',
          { xmlns: FORWARD_NAMESPACE },
          xml('delay', { xmlns: DELAY_NAMESPACE, stamp: '2026-09-26T07:00:00.000Z' }),
          inner,
        ),
      ),
    );

    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.reactions).toEqual({ targetId: 'sid-1', emojis: ['❤️'] });
    expect(message?.fromJid).toBe('alice@galena.localhost');
    expect(message?.chatJid).toBe('project@rooms.galena.localhost');
  });
});
