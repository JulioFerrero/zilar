import { describe, expect, it } from 'vitest';
import { xml, type XmppElement } from '@xmpp/client';
import { encodePayload, type Payload } from '@zilar/protocol';
import {
  buildCarbonsEnable,
  buildCorrection,
  buildDisplayed,
  buildJoinPresence,
  buildLeavePresence,
  buildMessage,
  buildReactions,
  buildRetraction,
  buildTyping,
  buildUploadSlotRequest,
  decodeMessageStanza,
  isMamResult,
  mamResultQueryId,
  originIdOf,
  parseCorrection,
  parseReactions,
  parseRetraction,
  parseUploadSlot,
  RETRACTION_FALLBACK_BODY,
  sanitizeReactions,
  type ParseContext,
} from './stanza';
import { MAX_BODY_BYTES, capBody, utf8ByteLength } from './text';
import {
  AGENT_NAMESPACE,
  CARBONS_NAMESPACE,
  CHAT_MARKERS_NAMESPACE,
  CHAT_STATES_NAMESPACE,
  CORRECTION_NAMESPACE,
  DELAY_NAMESPACE,
  FALLBACK_NAMESPACE,
  FORWARD_NAMESPACE,
  HINTS_NAMESPACE,
  HTTP_UPLOAD_NAMESPACE,
  MAM_NAMESPACE,
  MUC_NAMESPACE,
  MUC_USER_NAMESPACE,
  REACTIONS_NAMESPACE,
  REFERENCE_NAMESPACE,
  REPLY_NAMESPACE,
  RETRACTION_NAMESPACE,
  STANZA_ID_NAMESPACE,
} from './namespaces';

const ctx: ParseContext = {
  me: 'bob@zilar.localhost',
  domain: 'zilar.localhost',
  mucDomain: 'rooms.zilar.localhost',
  now: () => new Date('2026-09-27T12:00:00.000Z'),
};

const progress: Payload = {
  v: 0,
  type: 'progress',
  data: { ai: 'dev-1@zilar.localhost', stage: 'running the tests', percent: 40 },
};

function mucUser(jid: string, extras: Record<string, string> = {}): XmppElement {
  return xml('x', { xmlns: MUC_USER_NAMESPACE }, xml('item', { jid, ...extras }));
}

describe('buildMessage', () => {
  it('sets the type, id, recipient, body, payload and reply', () => {
    const stanza = buildMessage({
      id: 'm-1',
      to: 'project@rooms.zilar.localhost',
      kind: 'groupchat',
      text: 'hello room',
      payload: progress,
      replyTo: { id: 'm-0', to: 'alice@zilar.localhost' },
    });

    expect(stanza.is('message')).toBe(true);
    expect(stanza.attrs).toMatchObject({
      type: 'groupchat',
      to: 'project@rooms.zilar.localhost',
      id: 'm-1',
    });
    expect(stanza.getChildText('body')).toBe('hello room');

    const agent = stanza.getChild('agent', AGENT_NAMESPACE);
    expect(agent?.text()).toBe(encodePayload(progress));

    const reply = stanza.getChild('reply', REPLY_NAMESPACE);
    expect(reply?.attrs['id']).toBe('m-0');
    expect(reply?.attrs['to']).toBe('alice@zilar.localhost');
  });

  it('omits the payload and reply elements when they are not given', () => {
    const stanza = buildMessage({
      id: 'm-2',
      to: 'alice@zilar.localhost',
      kind: 'chat',
      text: 'hi',
    });
    expect(stanza.getChild('agent', AGENT_NAMESPACE)).toBeUndefined();
    expect(stanza.getChild('reply', REPLY_NAMESPACE)).toBeUndefined();
  });

  it('carries the store hint on a body-less payload message so the archive keeps it', () => {
    // A voice note has an empty body: without the hint ejabberd's archive
    // drops it and it is gone after a reload (device test 2026-10-03).
    const voice = buildMessage({
      id: 'm-3',
      to: 'alice@zilar.localhost',
      kind: 'chat',
      text: '',
      payload: progress,
    });
    expect(voice.getChild('store', 'urn:xmpp:hints')).toBeDefined();

    const emptyText = buildMessage({
      id: 'm-4',
      to: 'alice@zilar.localhost',
      kind: 'chat',
      text: '',
    });
    expect(emptyText.getChild('store', 'urn:xmpp:hints')).toBeDefined();
  });

  it('adds no store hint to an ordinary text message (the archive keeps it by itself)', () => {
    const plain = buildMessage({
      id: 'm-5',
      to: 'alice@zilar.localhost',
      kind: 'chat',
      text: 'hi',
    });
    expect(plain.getChild('store', 'urn:xmpp:hints')).toBeUndefined();
  });
});

describe('buildTyping, buildDisplayed, presence and carbons', () => {
  it('builds a composing chat state addressed to the conversation', () => {
    const stanza = buildTyping({
      to: 'project@rooms.zilar.localhost',
      kind: 'groupchat',
      state: 'composing',
    });
    expect(stanza.attrs).toMatchObject({ type: 'groupchat', to: 'project@rooms.zilar.localhost' });
    expect(stanza.getChild('composing', CHAT_STATES_NAMESPACE)).toBeDefined();
  });

  it('builds a displayed marker for a message id', () => {
    const stanza = buildDisplayed({
      chatJid: 'alice@zilar.localhost',
      kind: 'chat',
      messageId: 'm-9',
    });
    const displayed = stanza.getChild('displayed', CHAT_MARKERS_NAMESPACE);
    expect(displayed?.attrs['id']).toBe('m-9');
  });

  it('asks for no MUC history when joining', () => {
    const stanza = buildJoinPresence('project@rooms.zilar.localhost', 'bob');
    expect(stanza.attrs).toMatchObject({
      to: 'project@rooms.zilar.localhost/bob',
    });
    const history = stanza.getChild('x', MUC_NAMESPACE)?.getChild('history');
    expect(history?.attrs['maxstanzas']).toBe('0');
  });

  it('leaves with an unavailable presence', () => {
    const stanza = buildLeavePresence('project@rooms.zilar.localhost', 'bob');
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
      service: 'upload.zilar.localhost',
      filename: 'voice.m4a',
      size: 4096,
      contentType: 'audio/mp4',
    });
    expect(stanza.attrs).toMatchObject({
      type: 'get',
      id: 'iq-up-1',
      to: 'upload.zilar.localhost',
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
        from: 'project@rooms.zilar.localhost/alice',
        to: 'bob@zilar.localhost',
        type: 'groupchat',
        id: 'm-1',
      },
      xml('body', {}, 'hello room'),
      mucUser('alice@zilar.localhost'),
    );

    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message).toMatchObject({
      id: 'm-1',
      chatJid: 'project@rooms.zilar.localhost',
      kind: 'groupchat',
      fromJid: 'alice@zilar.localhost',
      fromNick: 'alice',
      body: 'hello room',
      outgoing: false,
    });
    expect(message?.timestamp.toISOString()).toBe('2026-09-27T12:00:00.000Z');
  });

  it('marks my own room reflection as outgoing via the item JID', () => {
    const stanza = xml(
      'message',
      { from: 'project@rooms.zilar.localhost/bob', type: 'groupchat', id: 'm-2' },
      xml('body', {}, 'mine'),
      mucUser('bob@zilar.localhost', { affiliation: 'owner', role: 'moderator' }),
    );
    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.outgoing).toBe(true);
    expect(message?.fromJid).toBe('bob@zilar.localhost');
  });

  it('parses a DM with the peer as the conversation', () => {
    const stanza = xml(
      'message',
      {
        from: 'alice@zilar.localhost/phone',
        to: 'bob@zilar.localhost/laptop',
        type: 'chat',
        id: 'm-3',
      },
      xml('body', {}, 'hi bob'),
    );
    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message).toMatchObject({
      id: 'm-3',
      chatJid: 'alice@zilar.localhost',
      kind: 'chat',
      fromJid: 'alice@zilar.localhost',
      body: 'hi bob',
      outgoing: false,
    });
  });

  it('parses a sent carbon and marks it outgoing', () => {
    const stanza = xml(
      'message',
      { from: 'bob@zilar.localhost/laptop', to: 'bob@zilar.localhost/laptop', type: 'chat' },
      xml(
        'sent',
        { xmlns: CARBONS_NAMESPACE },
        xml(
          'forwarded',
          { xmlns: FORWARD_NAMESPACE },
          xml(
            'message',
            {
              from: 'bob@zilar.localhost/phone',
              to: 'alice@zilar.localhost',
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
      chatJid: 'alice@zilar.localhost',
      fromJid: 'bob@zilar.localhost',
      body: 'from my phone',
      outgoing: true,
    });
  });

  it('parses a received carbon', () => {
    const stanza = xml(
      'message',
      { from: 'bob@zilar.localhost/laptop', to: 'bob@zilar.localhost/laptop', type: 'chat' },
      xml(
        'received',
        { xmlns: CARBONS_NAMESPACE },
        xml(
          'forwarded',
          { xmlns: FORWARD_NAMESPACE },
          xml(
            'message',
            {
              from: 'alice@zilar.localhost/phone',
              to: 'bob@zilar.localhost',
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
      chatJid: 'alice@zilar.localhost',
      fromJid: 'alice@zilar.localhost',
      body: 'to all my devices',
      outgoing: false,
    });
  });

  it('reads the timestamp from a delay element', () => {
    const stanza = xml(
      'message',
      { from: 'alice@zilar.localhost', to: 'bob@zilar.localhost', type: 'chat', id: 'm-6' },
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
      { from: 'dev-1@zilar.localhost', to: 'bob@zilar.localhost', type: 'chat', id: 'm-7' },
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
      { from: 'dev-1@zilar.localhost', type: 'chat', id: 'm-8' },
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
      data: { ai: 'dev-1@zilar.localhost', stage: 'x'.repeat(70 * 1024) },
    });
    const stanza = xml(
      'message',
      { from: 'dev-1@zilar.localhost', type: 'chat', id: 'm-9' },
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
      { from: 'dev-1@zilar.localhost', type: 'chat', id: 'm-10' },
      xml('agent', { xmlns: AGENT_NAMESPACE }, encodePayload(progress)),
    );
    expect(decodeMessageStanza(withPayload, ctx).message?.payload).toEqual(progress);

    const withoutAgent = xml(
      'message',
      { from: 'dev-1@zilar.localhost', type: 'chat', id: 'm-11' },
      xml('body', {}, 'no payload'),
    );
    expect(decodeMessageStanza(withoutAgent, ctx).message?.payload).toBeUndefined();
  });
});

describe('decodeMessageStanza: replies, typing and displayed', () => {
  it('parses a reply', () => {
    const stanza = xml(
      'message',
      { from: 'alice@zilar.localhost', type: 'chat', id: 'm-12' },
      xml('body', {}, 'replying'),
      xml('reply', { xmlns: REPLY_NAMESPACE, id: 'm-1', to: 'bob@zilar.localhost' }),
    );
    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.replyTo).toEqual({ id: 'm-1', to: 'bob@zilar.localhost' });
  });

  it('parses every typing state without producing a message', () => {
    for (const state of ['composing', 'paused', 'active'] as const) {
      const stanza = xml(
        'message',
        { from: 'alice@zilar.localhost', to: 'bob@zilar.localhost', type: 'chat' },
        xml(state, { xmlns: CHAT_STATES_NAMESPACE }),
      );
      const decoded = decodeMessageStanza(stanza, ctx);
      expect(decoded.message).toBeUndefined();
      expect(decoded.typing).toEqual({
        chatJid: 'alice@zilar.localhost',
        fromJid: 'alice@zilar.localhost',
        state,
        outgoing: false,
      });
    }
  });

  it('parses a displayed marker', () => {
    const stanza = xml(
      'message',
      { from: 'alice@zilar.localhost', to: 'bob@zilar.localhost', type: 'chat' },
      xml('displayed', { xmlns: CHAT_MARKERS_NAMESPACE, id: 'm-1' }),
    );
    const decoded = decodeMessageStanza(stanza, ctx);
    expect(decoded.message).toBeUndefined();
    expect(decoded.displayed).toEqual({
      chatJid: 'alice@zilar.localhost',
      fromJid: 'alice@zilar.localhost',
      messageId: 'm-1',
      outgoing: false,
    });
  });
});

describe('decodeMessageStanza: domain filter', () => {
  it('ignores messages from another domain', () => {
    const stanza = xml(
      'message',
      { from: 'alice@evil.example.com', to: 'bob@zilar.localhost', type: 'chat', id: 'm-13' },
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
      { from: 'room@rooms.zilar.localhost', type: 'chat', id: 'm-15' },
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
      { from: 'project@rooms.zilar.localhost/alice', type: 'groupchat', id: 'm-16' },
      xml('body', {}, 'archived'),
      mucUser('alice@zilar.localhost'),
    );
    if (options.withStanzaId === true) {
      inner.children.push(
        xml('stanza-id', {
          xmlns: STANZA_ID_NAMESPACE,
          by: 'project@rooms.zilar.localhost',
          id: 'sid-1',
        }),
      );
    }
    return xml(
      'message',
      { from: 'project@rooms.zilar.localhost', to: 'bob@zilar.localhost/laptop' },
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
      chatJid: 'project@rooms.zilar.localhost',
      fromJid: 'alice@zilar.localhost',
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
      to: 'project@rooms.zilar.localhost',
      kind: 'groupchat',
      text: 'hi 😀 @Ana and @Luis',
      mentions: [
        { jid: 'ana@zilar.localhost', begin: 6, end: 10 },
        { jid: 'luis@zilar.localhost', begin: 15, end: 20 },
      ],
    });

    const references = stanza.getChildren('reference', REFERENCE_NAMESPACE);
    expect(references).toHaveLength(2);
    // The emoji is one code point, so each offset is two lower than the UTF-16
    // index the caller passed.
    expect(references[0]?.attrs).toMatchObject({
      type: 'mention',
      uri: 'xmpp:ana@zilar.localhost',
      begin: '5',
      end: '9',
    });
    expect(references[1]?.attrs).toMatchObject({
      type: 'mention',
      uri: 'xmpp:luis@zilar.localhost',
      begin: '14',
      end: '19',
    });
  });

  it('builds no references without mentions', () => {
    const stanza = buildMessage({
      id: 'm-21',
      to: 'project@rooms.zilar.localhost',
      kind: 'groupchat',
      text: 'plain',
    });
    expect(stanza.getChildren('reference', REFERENCE_NAMESPACE)).toHaveLength(0);
  });

  it('skips invalid ranges and caps at twenty mentions', () => {
    const text = 'hi there';
    const invalid = [
      { jid: 'a@zilar.localhost', begin: -1, end: 2 },
      { jid: 'b@zilar.localhost', begin: 2, end: 2 },
      { jid: 'c@zilar.localhost', begin: 5, end: 3 },
      { jid: 'd@zilar.localhost', begin: 0, end: text.length + 1 },
      { jid: 'e@zilar.localhost', begin: 1.5, end: 3 },
    ];
    const valid = Array.from({ length: 25 }, (_, index) => ({
      jid: `u${index}@zilar.localhost`,
      begin: 0,
      end: 2,
    }));
    const stanza = buildMessage({
      id: 'm-29',
      to: 'project@rooms.zilar.localhost',
      kind: 'groupchat',
      text,
      mentions: [...invalid, ...valid],
    });

    const references = stanza.getChildren('reference', REFERENCE_NAMESPACE);
    expect(references).toHaveLength(20);
    expect(references[0]?.attrs['uri']).toBe('xmpp:u0@zilar.localhost');
    expect(references[19]?.attrs['uri']).toBe('xmpp:u19@zilar.localhost');
  });

  it('round trips mentions through build and parse', () => {
    const built = buildMessage({
      id: 'm-22',
      to: 'project@rooms.zilar.localhost',
      kind: 'groupchat',
      text: 'hi 😀 @Ana',
      mentions: [{ jid: 'ana@zilar.localhost', begin: 6, end: 10 }],
    });
    const stanza = xml(
      'message',
      {
        from: 'project@rooms.zilar.localhost/alice',
        to: 'bob@zilar.localhost',
        type: 'groupchat',
        id: 'm-22',
      },
      ...built.children,
      mucUser('alice@zilar.localhost'),
    );

    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.mentions).toEqual([{ jid: 'ana@zilar.localhost', begin: 6, end: 10 }]);
  });

  it('parses a mention and lowers the bare JID, dropping resource and query', () => {
    const stanza = xml(
      'message',
      { from: 'alice@zilar.localhost', type: 'chat', id: 'm-23' },
      xml('body', {}, 'hey @Ana'),
      reference({
        type: 'mention',
        uri: 'xmpp:ANA@Zilar.Localhost/resource?query=1',
        begin: '4',
        end: '8',
      }),
    );
    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.mentions).toEqual([{ jid: 'ana@zilar.localhost', begin: 4, end: 8 }]);
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
        { from: 'alice@zilar.localhost', type: 'chat', id: 'm-24' },
        xml('body', {}, 'hey @Ana'),
        reference({ type: 'mention', uri: 'xmpp:ana@zilar.localhost', ...offsets }),
      );
      const { message } = decodeMessageStanza(stanza, ctx);
      expect(message?.mentions).toEqual([{ jid: 'ana@zilar.localhost' }]);
    }
  });

  it('drops a bad URI, a non-xmpp URI and a wrong reference type', () => {
    const stanza = xml(
      'message',
      { from: 'alice@zilar.localhost', type: 'chat', id: 'm-25' },
      xml('body', {}, 'hey'),
      reference({ type: 'mention', uri: 'xmpp:not-a-jid', begin: '0', end: '3' }),
      reference({ type: 'mention', uri: 'https://example.com', begin: '0', end: '3' }),
      reference({ type: 'reply', uri: 'xmpp:ana@zilar.localhost', begin: '0', end: '3' }),
    );
    expect(decodeMessageStanza(stanza, ctx).message?.mentions).toBeUndefined();
  });

  it('caps a message at twenty mentions', () => {
    const references = Array.from({ length: 25 }, (_, index) =>
      reference({ type: 'mention', uri: `xmpp:u${index}@zilar.localhost` }),
    );
    const stanza = xml(
      'message',
      { from: 'alice@zilar.localhost', type: 'chat', id: 'm-26' },
      xml('body', {}, 'many'),
      ...references,
    );
    const mentions = decodeMessageStanza(stanza, ctx).message?.mentions ?? [];
    expect(mentions).toHaveLength(20);
    expect(mentions[0]?.jid).toBe('u0@zilar.localhost');
    expect(mentions[19]?.jid).toBe('u19@zilar.localhost');
  });

  it('parses mentions inside a forwarded carbon', () => {
    const stanza = xml(
      'message',
      { from: 'bob@zilar.localhost/laptop', type: 'chat' },
      xml(
        'received',
        { xmlns: CARBONS_NAMESPACE },
        xml(
          'forwarded',
          { xmlns: FORWARD_NAMESPACE },
          xml(
            'message',
            {
              from: 'alice@zilar.localhost',
              to: 'bob@zilar.localhost',
              type: 'chat',
              id: 'm-27',
            },
            xml('body', {}, 'hey @Ana'),
            reference({ type: 'mention', uri: 'xmpp:ana@zilar.localhost', begin: '4', end: '8' }),
          ),
        ),
      ),
    );
    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.mentions).toEqual([{ jid: 'ana@zilar.localhost', begin: 4, end: 8 }]);
  });

  it('parses mentions inside a MAM result', () => {
    const inner = xml(
      'message',
      { from: 'project@rooms.zilar.localhost/alice', type: 'groupchat', id: 'm-28' },
      xml('body', {}, 'hey @Ana'),
      reference({ type: 'mention', uri: 'xmpp:ana@zilar.localhost', begin: '4', end: '8' }),
      mucUser('alice@zilar.localhost'),
    );
    const stanza = xml(
      'message',
      { from: 'project@rooms.zilar.localhost', to: 'bob@zilar.localhost/laptop' },
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
    expect(message?.mentions).toEqual([{ jid: 'ana@zilar.localhost', begin: 4, end: 8 }]);
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
      xml('message', { from: 'alice@zilar.localhost', type: 'chat' }, xml('body')),
    ],
    [
      'an unparseable payload',
      xml(
        'message',
        { from: 'alice@zilar.localhost', type: 'chat' },
        xml('body', {}, 'x'),
        xml('agent', { xmlns: AGENT_NAMESPACE }, '{"v":0,"type":"task","data":{}}'),
      ),
    ],
    [
      'a MUC user element without an item',
      xml(
        'message',
        { from: 'project@rooms.zilar.localhost', type: 'groupchat' },
        xml('x', { xmlns: MUC_USER_NAMESPACE }),
      ),
    ],
    [
      'a MAM result without a forwarded element',
      xml(
        'message',
        { from: 'project@rooms.zilar.localhost' },
        xml('result', { xmlns: MAM_NAMESPACE, queryid: 'q' }),
      ),
    ],
    [
      'a reply without an id',
      xml(
        'message',
        { from: 'alice@zilar.localhost', type: 'chat' },
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
      { from: 'alice@zilar.localhost', type: 'chat' },
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
      to: 'project@rooms.zilar.localhost',
      kind: 'groupchat',
      targetId: 'sid-1',
      emojis: ['👍', '❤️'],
    });

    expect(stanza.attrs).toMatchObject({
      type: 'groupchat',
      to: 'project@rooms.zilar.localhost',
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
      to: 'alice@zilar.localhost',
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
      to: 'alice@zilar.localhost',
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
      { from: 'alice@zilar.localhost', to: 'bob@zilar.localhost', type: 'chat', id: 'm-30' },
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
      { from: 'alice@zilar.localhost', type: 'chat', id: 'm-31' },
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
      { from: 'alice@zilar.localhost', type: 'chat', id: 'm-32' },
      xml('reactions', { xmlns: REACTIONS_NAMESPACE }, xml('reaction', {}, '👍')),
    );
    expect(parseReactions(stanza)).toBeUndefined();
    expect(decodeMessageStanza(stanza, ctx).message).toBeUndefined();
  });

  it('parses reactions inside a received carbon', () => {
    const stanza = xml(
      'message',
      { from: 'bob@zilar.localhost/laptop', to: 'bob@zilar.localhost/laptop', type: 'chat' },
      xml(
        'received',
        { xmlns: CARBONS_NAMESPACE },
        xml(
          'forwarded',
          { xmlns: FORWARD_NAMESPACE },
          xml(
            'message',
            {
              from: 'alice@zilar.localhost',
              to: 'bob@zilar.localhost',
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
      { from: 'project@rooms.zilar.localhost/alice', type: 'groupchat', id: 'm-34' },
      reactionUpdate('sid-1', ['❤️']),
      mucUser('alice@zilar.localhost'),
    );
    const stanza = xml(
      'message',
      { from: 'project@rooms.zilar.localhost', to: 'bob@zilar.localhost/laptop' },
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
    expect(message?.fromJid).toBe('alice@zilar.localhost');
    expect(message?.chatJid).toBe('project@rooms.zilar.localhost');
  });
});

describe('XEP-0308 corrections and XEP-0424 retractions', () => {
  it('builds a correction: new body, replace id and rebuilt mentions', () => {
    const stanza = buildCorrection({
      id: 'm-c1',
      to: 'project@rooms.zilar.localhost',
      kind: 'groupchat',
      originalId: 'origin-1',
      text: 'hi 😀 @Ana',
      mentions: [{ jid: 'ana@zilar.localhost', begin: 6, end: 10 }],
    });

    expect(stanza.attrs).toMatchObject({
      type: 'groupchat',
      to: 'project@rooms.zilar.localhost',
      id: 'm-c1',
    });
    expect(stanza.getChildText('body')).toBe('hi 😀 @Ana');
    const replace = stanza.getChild('replace', CORRECTION_NAMESPACE);
    expect(replace?.attrs['id']).toBe('origin-1');
    const references = stanza.getChildren('reference', REFERENCE_NAMESPACE);
    expect(references).toHaveLength(1);
    // The emoji is one code point, not two UTF-16 units.
    expect(references[0]?.attrs).toMatchObject({
      type: 'mention',
      uri: 'xmpp:ana@zilar.localhost',
      begin: '5',
      end: '9',
    });
  });

  it('builds a retraction with the target, the fallback and the store hint', () => {
    const stanza = buildRetraction({
      id: 'm-r1',
      to: 'project@rooms.zilar.localhost',
      kind: 'groupchat',
      targetId: 'sid-1',
    });

    expect(stanza.attrs).toMatchObject({
      type: 'groupchat',
      to: 'project@rooms.zilar.localhost',
      id: 'm-r1',
    });
    expect(stanza.getChild('retract', RETRACTION_NAMESPACE)?.attrs['id']).toBe('sid-1');
    expect(stanza.getChild('fallback', FALLBACK_NAMESPACE)?.attrs['for']).toBe(
      RETRACTION_NAMESPACE,
    );
    expect(stanza.getChildText('body')).toBe(RETRACTION_FALLBACK_BODY);
    expect(stanza.getChild('store', HINTS_NAMESPACE)).toBeDefined();
  });

  it('parses a correction and keeps the new body', () => {
    const stanza = xml(
      'message',
      { from: 'alice@zilar.localhost', to: 'bob@zilar.localhost', type: 'chat', id: 'm-50' },
      xml('body', {}, 'the new text'),
      xml('replace', { xmlns: CORRECTION_NAMESPACE, id: 'm-1' }),
    );

    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.body).toBe('the new text');
    expect(message?.correction).toEqual({ targetId: 'm-1' });
    // The stanza's own id is the sender-generated origin id.
    expect(message?.originId).toBe('m-50');
  });

  it('parses a retraction and drops the fallback body', () => {
    const stanza = xml(
      'message',
      { from: 'alice@zilar.localhost', to: 'bob@zilar.localhost', type: 'chat', id: 'm-51' },
      xml('retract', { xmlns: RETRACTION_NAMESPACE, id: 'm-1' }),
      xml('fallback', { xmlns: FALLBACK_NAMESPACE, for: RETRACTION_NAMESPACE }),
      xml('body', {}, RETRACTION_FALLBACK_BODY),
      xml('store', { xmlns: HINTS_NAMESPACE }),
    );

    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.body).toBeUndefined();
    expect(message?.retraction).toEqual({ targetId: 'm-1' });
  });

  it('ignores a correction or a retraction without a target id', () => {
    const correction = xml(
      'message',
      { from: 'alice@zilar.localhost', type: 'chat', id: 'm-52' },
      xml('body', {}, 'no target'),
      xml('replace', { xmlns: CORRECTION_NAMESPACE }),
    );
    expect(parseCorrection(correction)).toBeUndefined();

    const retraction = xml(
      'message',
      { from: 'alice@zilar.localhost', type: 'chat', id: 'm-53' },
      xml('retract', { xmlns: RETRACTION_NAMESPACE }),
    );
    expect(parseRetraction(retraction)).toBeUndefined();
    expect(decodeMessageStanza(retraction, ctx).message).toBeUndefined();
  });

  it('prefers an origin-id over the stanza id', () => {
    const stanza = xml(
      'message',
      { from: 'alice@zilar.localhost', type: 'chat', id: 'm-54' },
      xml('origin-id', { xmlns: STANZA_ID_NAMESPACE, id: 'origin-9' }),
      xml('body', {}, 'hi'),
    );
    expect(originIdOf(stanza)).toBe('origin-9');
    expect(decodeMessageStanza(stanza, ctx).message?.originId).toBe('origin-9');
  });

  it('parses a correction inside a received carbon', () => {
    const stanza = xml(
      'message',
      { from: 'bob@zilar.localhost/laptop', to: 'bob@zilar.localhost/laptop', type: 'chat' },
      xml(
        'received',
        { xmlns: CARBONS_NAMESPACE },
        xml(
          'forwarded',
          { xmlns: FORWARD_NAMESPACE },
          xml(
            'message',
            {
              from: 'alice@zilar.localhost',
              to: 'bob@zilar.localhost',
              type: 'chat',
              id: 'm-55',
            },
            xml('body', {}, 'fixed text'),
            xml('replace', { xmlns: CORRECTION_NAMESPACE, id: 'm-1' }),
          ),
        ),
      ),
    );

    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.body).toBe('fixed text');
    expect(message?.correction).toEqual({ targetId: 'm-1' });
  });

  it('parses a group retraction inside a MAM result by its stanza-id target', () => {
    const inner = xml(
      'message',
      { from: 'project@rooms.zilar.localhost/alice', type: 'groupchat', id: 'm-56' },
      xml('retract', { xmlns: RETRACTION_NAMESPACE, id: 'sid-1' }),
      xml('body', {}, RETRACTION_FALLBACK_BODY),
      mucUser('alice@zilar.localhost'),
    );
    const stanza = xml(
      'message',
      { from: 'project@rooms.zilar.localhost', to: 'bob@zilar.localhost/laptop' },
      xml(
        'result',
        { xmlns: MAM_NAMESPACE, queryid: 'q1', id: 'archive-3' },
        xml(
          'forwarded',
          { xmlns: FORWARD_NAMESPACE },
          xml('delay', { xmlns: DELAY_NAMESPACE, stamp: '2026-09-26T08:00:00.000Z' }),
          inner,
        ),
      ),
    );

    const { message } = decodeMessageStanza(stanza, ctx);
    expect(message?.id).toBe('archive-3');
    expect(message?.body).toBeUndefined();
    expect(message?.retraction).toEqual({ targetId: 'sid-1' });
    expect(message?.fromJid).toBe('alice@zilar.localhost');
  });
});
