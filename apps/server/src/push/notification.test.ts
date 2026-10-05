import { describe, expect, it } from 'vitest';
import type { PushXmppElement } from '@xmpp/component';
import { parsePushIq } from './notification';
import { parseNode, PUBSUB_NAMESPACE, PUSH_NAMESPACE, randomNode } from './protocol';

// Minimal structural fake: `parsePushIq` only reads this surface.
function element(
  name: string,
  attrs: Record<string, string> = {},
  children: PushXmppElement[] = [],
  text = '',
): PushXmppElement {
  return {
    is: (candidate) => candidate === name,
    attrs,
    getChild: (childName, xmlns) =>
      children.find(
        (child) =>
          child.getName() === childName && (xmlns === undefined || child.attrs['xmlns'] === xmlns),
      ),
    getChildren: (childName, xmlns) =>
      children.filter(
        (child) =>
          child.getName() === childName && (xmlns === undefined || child.attrs['xmlns'] === xmlns),
      ),
    getChildText: (childName) =>
      children.find((child) => child.getName() === childName)?.text() ?? undefined,
    getName: () => name,
    getChildElements: () => children,
    text: () => text,
  };
}

function value(text: string): PushXmppElement {
  return element('value', {}, [], text);
}

function publishIq(node: string, fields: Array<[string, string]> = []): PushXmppElement {
  const summary = element('x', { xmlns: 'jabber:x:data' }, [
    element('field', { var: 'FORM_TYPE' }, [value('urn:xmpp:push:summary')]),
    ...fields.map(([name, text]) => element('field', { var: name }, [value(text)])),
  ]);
  return element(
    'iq',
    { type: 'set', from: 'zilar.localhost', to: 'push.zilar.localhost', id: 'n1' },
    [
      element('pubsub', { xmlns: PUBSUB_NAMESPACE }, [
        element('publish', { node }, [
          element('item', {}, [element('notification', { xmlns: PUSH_NAMESPACE }, [summary])]),
        ]),
      ]),
    ],
  );
}

describe('parsePushIq', () => {
  it('parses a publish IQ with the summary fields', () => {
    const parsed = parsePushIq(
      publishIq('p-device1', [
        ['last-message-sender', 'ana@zilar.localhost'],
        ['last-message-body', 'hello'],
      ]),
    );
    expect(parsed).toMatchObject({
      node: 'p-device1',
      from: 'zilar.localhost',
      lastMessageSender: 'ana@zilar.localhost',
      lastMessageBody: 'hello',
    });
  });

  it('parses a notification without a summary form', () => {
    const stanza = element('iq', { type: 'set', from: 'zilar.localhost', id: 'n1' }, [
      element('pubsub', { xmlns: PUBSUB_NAMESPACE }, [
        element('publish', { node: 'p-x' }, [
          element('item', {}, [element('notification', { xmlns: PUSH_NAMESPACE }, [])]),
        ]),
      ]),
    ]);
    expect(parsePushIq(stanza)).toMatchObject({ node: 'p-x', from: 'zilar.localhost' });
  });

  it('rejects non-publish stanzas', () => {
    expect(parsePushIq(element('message', {}, []))).toBeUndefined();
    expect(parsePushIq(element('iq', { type: 'result' }, []))).toBeUndefined();
    expect(parsePushIq(element('iq', { type: 'set' }, []))).toBeUndefined();
    expect(parsePushIq(publishIq(''))).toBeUndefined();
  });
});

describe('push nodes', () => {
  it('generates URL-safe unique nodes', () => {
    const nodes = new Set([randomNode(), randomNode(), randomNode()]);
    expect(nodes.size).toBe(3);
    for (const node of nodes) {
      expect(parseNode(node)).toBe(node);
    }
  });

  it('rejects invalid nodes', () => {
    expect(() => parseNode('')).toThrow();
    expect(() => parseNode('has space')).toThrow();
    expect(() => parseNode('x'.repeat(257))).toThrow();
  });
});
