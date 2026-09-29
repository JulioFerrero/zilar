import { xml } from '@xmpp/component';
import { describe, expect, it } from 'vitest';
import { parsePushIq } from './notification';
import { PUBSUB_NAMESPACE, PUSH_NAMESPACE } from './protocol';

const SUMMARY_FORM = 'urn:xmpp:push:summary';

function summaryField(name: string, value: string) {
  return xml('field', { var: name }, xml('value', {}, value));
}

function publishIq(options: {
  node?: string;
  summaryFields?: Array<{ name: string; value: string }>;
  secret?: string;
  noNotification?: boolean;
}) {
  const children: Array<ReturnType<typeof xml>> = [
    xml(
      'publish',
      { node: options.node ?? 'spike-abc123' },
      xml(
        'item',
        {},
        options.noNotification
          ? xml('unexpected', { xmlns: 'urn:example:other' })
          : xml(
              'notification',
              { xmlns: PUSH_NAMESPACE },
              ...(options.summaryFields === undefined
                ? []
                : [
                    xml(
                      'x',
                      { xmlns: 'jabber:x:data', type: 'submit' },
                      xml('field', { var: 'FORM_TYPE' }, xml('value', {}, SUMMARY_FORM)),
                      ...options.summaryFields.map((field) =>
                        summaryField(field.name, field.value),
                      ),
                    ),
                  ]),
            ),
      ),
    ),
  ];
  if (options.secret !== undefined) {
    children.push(
      xml(
        'publish-options',
        {},
        xml(
          'x',
          { xmlns: 'jabber:x:data', type: 'submit' },
          xml(
            'field',
            { var: 'FORM_TYPE' },
            xml('value', {}, 'http://jabber.org/protocol/pubsub#publish-options'),
          ),
          summaryField('secret', options.secret),
        ),
      ),
    );
  }
  return xml(
    'iq',
    { type: 'set', from: 'galena.localhost', to: 'push.galena.localhost', id: 'n12' },
    xml('pubsub', { xmlns: PUBSUB_NAMESPACE }, ...children),
  );
}

describe('parsePushIq', () => {
  it('parses a full DM notification with sender, body and secret', () => {
    const stanza = publishIq({
      summaryFields: [
        { name: 'last-message-sender', value: 'ana@galena.localhost/mobile' },
        { name: 'last-message-body', value: 'Wherefore art thou?' },
      ],
      secret: 'eruio234vzxc2kla-91',
    });

    expect(parsePushIq(stanza)).toEqual({
      node: 'spike-abc123',
      from: 'galena.localhost',
      lastMessageSender: 'ana@galena.localhost/mobile',
      lastMessageBody: 'Wherefore art thou?',
      publishOptionsSecret: 'eruio234vzxc2kla-91',
    });
  });

  it('parses a group notification that only carries the static body marker', () => {
    const stanza = publishIq({
      summaryFields: [{ name: 'last-message-body', value: 'New message' }],
    });

    expect(parsePushIq(stanza)).toEqual({
      node: 'spike-abc123',
      from: 'galena.localhost',
      lastMessageBody: 'New message',
    });
  });

  it('accepts a notification with no summary form (notify_on=all traffic)', () => {
    expect(parsePushIq(publishIq({}))).toEqual({
      node: 'spike-abc123',
      from: 'galena.localhost',
    });
  });

  it('rejects stanzas without a notification payload', () => {
    expect(parsePushIq(publishIq({ noNotification: true }))).toBeUndefined();
  });

  it('rejects non-set IQs and non-IQ stanzas', () => {
    const stanza = publishIq({});
    stanza.attrs['type'] = 'result';
    expect(parsePushIq(stanza)).toBeUndefined();
    expect(parsePushIq(xml('message', { from: 'a', to: 'b' }))).toBeUndefined();
  });
});
