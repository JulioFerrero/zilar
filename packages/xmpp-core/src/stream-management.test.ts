import { describe, expect, it } from 'vitest';
import { xml, type XmppClient, type XmppElement } from '@xmpp/client';
import {
  STREAM_MANAGEMENT_NS,
  createStreamManagementAck,
  installStreamManagementAck,
} from './stream-management';

function nonza(name: string): XmppElement {
  return xml(name, { xmlns: STREAM_MANAGEMENT_NS });
}

function stanza(name: string): XmppElement {
  return xml(name, { xmlns: 'jabber:client' });
}

describe('createStreamManagementAck', () => {
  it('does not count stanzas received before <enabled/>', () => {
    const ack = createStreamManagementAck();
    ack.observe(stanza('presence'));
    ack.observe(stanza('message'));
    expect(ack.inbound()).toBe(0);
    expect(ack.counting()).toBe(false);
  });

  it('starts at zero on <enabled/> and counts message, presence and iq', () => {
    const ack = createStreamManagementAck();
    ack.observe(stanza('presence'));
    ack.observe(nonza('enabled'));
    expect(ack.inbound()).toBe(0);
    expect(ack.counting()).toBe(true);
    ack.observe(stanza('presence'));
    ack.observe(stanza('iq'));
    ack.observe(stanza('message'));
    expect(ack.inbound()).toBe(3);
  });

  it('ignores nonzas (stream features, <enable/>, <r/>, <a/>, <failed/>)', () => {
    const ack = createStreamManagementAck();
    ack.observe(nonza('enabled'));
    ack.observe(xml('features', { xmlns: 'http://etherx.jabber.org/streams' }));
    ack.observe(nonza('enable'));
    ack.observe(nonza('r'));
    ack.observe(nonza('a'));
    ack.observe(nonza('failed'));
    expect(ack.inbound()).toBe(0);
  });

  it('continues counting after <resumed/> instead of resetting', () => {
    const ack = createStreamManagementAck();
    ack.observe(nonza('enabled'));
    ack.observe(stanza('message'));
    ack.observe(stanza('message'));
    ack.observe(nonza('resumed'));
    expect(ack.inbound()).toBe(2);
    ack.observe(stanza('message'));
    expect(ack.inbound()).toBe(3);
  });

  it('stops counting on disconnect without losing the value', () => {
    const ack = createStreamManagementAck();
    ack.observe(nonza('enabled'));
    ack.observe(stanza('message'));
    ack.stop();
    ack.observe(stanza('message'));
    expect(ack.inbound()).toBe(1);
    ack.observe(nonza('enabled'));
    expect(ack.inbound()).toBe(0);
  });

  it('writes the count into outgoing <a/> and <resume/> only', () => {
    const ack = createStreamManagementAck();
    ack.observe(nonza('enabled'));
    ack.observe(stanza('presence'));
    ack.observe(stanza('iq'));

    const a = nonza('a');
    ack.correctOutgoing(a);
    expect(a.attrs['h']).toBe('2');

    const resume = xml('resume', { xmlns: STREAM_MANAGEMENT_NS, previd: 'abc' });
    ack.correctOutgoing(resume);
    expect(resume.attrs['h']).toBe('2');
    expect(resume.attrs['previd']).toBe('abc');

    const message = stanza('message');
    ack.correctOutgoing(message);
    expect(message.attrs['h']).toBeUndefined();
  });

  it('regression: does not acknowledge a pre-enable stanza when <r/> follows <enabled/>', () => {
    // The exact T-0021 sequence: the server echoes our presence before it has
    // enabled stream management, then <enabled/> and the carbons result and the
    // first <r/> arrive in the same parser batch.
    const ack = createStreamManagementAck();
    ack.observe(stanza('presence')); // pre-enable echo, server did not count it
    ack.observe(nonza('enabled'));
    ack.observe(stanza('iq')); // carbons result, server counted it (out = 1)
    ack.observe(nonza('r'));
    const a = nonza('a');
    ack.correctOutgoing(a);
    expect(a.attrs['h']).toBe('1');
  });
});

type Listener = (...args: unknown[]) => void;

function createFakeClient(withStreamManagement: boolean): {
  client: XmppClient;
  sent: XmppElement[];
  emit: (event: string, argument?: unknown) => void;
} {
  const listeners = new Map<string, Set<Listener>>();
  const sent: XmppElement[] = [];
  const client = {
    jid: null,
    status: 'offline',
    reconnect: { delay: 1000, on: () => client },
    ...(withStreamManagement ? { streamManagement: {} } : {}),
    async start() {},
    async stop() {},
    async disconnect() {},
    async send(element: XmppElement) {
      sent.push(element);
    },
    async sendMany(elements: XmppElement[]) {
      sent.push(...elements);
    },
    on(event: string, listener: Listener) {
      let set = listeners.get(event);
      if (set === undefined) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
      return client;
    },
    removeListener(event: string, listener: Listener) {
      listeners.get(event)?.delete(listener);
      return client;
    },
  } as unknown as XmppClient;

  return {
    client,
    sent,
    emit(event, argument) {
      for (const listener of listeners.get(event) ?? []) {
        if (argument === undefined) listener();
        else listener(argument);
      }
    },
  };
}

describe('installStreamManagementAck', () => {
  it('corrects the h of outgoing <a/> elements from the observed sequence', async () => {
    const { client, sent, emit } = createFakeClient(true);
    installStreamManagementAck(client);

    emit('element', stanza('presence')); // pre-enable
    emit('element', nonza('enabled'));
    emit('element', stanza('iq'));

    await client.send(nonza('a'));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.attrs['h']).toBe('1');
  });

  it('does nothing when the client has no stream management', async () => {
    const { client, sent, emit } = createFakeClient(false);
    installStreamManagementAck(client);

    emit('element', nonza('enabled'));
    emit('element', stanza('presence'));
    const a = nonza('a');
    await client.send(a);
    expect(sent[0]).toBe(a);
    expect(a.attrs['h']).toBeUndefined();
  });
});
