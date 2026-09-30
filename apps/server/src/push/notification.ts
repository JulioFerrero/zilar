import type { PushXmppElement } from '@xmpp/component';
import {
  DATA_FORMS_NAMESPACE,
  PUBSUB_NAMESPACE,
  PUSH_NAMESPACE,
  PUSH_SUMMARY_FORM_TYPE,
  type PushNotification,
} from './protocol';

// Parses the IQ ejabberd's mod_push routes to the component. Shape from the
// XEP-0357 example 12/13 and mod_push.erl `notify/7` (from = bare server
// JID, `<pubsub><publish node=...><item><notification/></item></publish>`
// plus optional `<publish-options>` carrying the enable-time secret).
export function parsePushIq(stanza: PushXmppElement): PushNotification | undefined {
  if (!stanza.is('iq') || stanza.attrs['type'] !== 'set') {
    return undefined;
  }
  const pubsub = stanza.getChild('pubsub', PUBSUB_NAMESPACE);
  if (pubsub === undefined) {
    return undefined;
  }
  const publish = pubsub.getChild('publish');
  if (publish === undefined) {
    return undefined;
  }
  const node = publish.attrs['node'];
  if (node === undefined || node === '') {
    return undefined;
  }
  const notification = publish.getChild('item')?.getChild('notification', PUSH_NAMESPACE);
  if (notification === undefined) {
    return undefined;
  }
  const from = stanza.attrs['from'];
  if (from === undefined || from === '') {
    return undefined;
  }

  const fields = readSummaryFields(notification);
  if (fields === undefined) {
    return undefined;
  }

  const options = pubsub.getChild('publish-options');
  const secret = options === undefined ? undefined : readPublishOption(options, 'secret');

  const result: PushNotification = {
    node,
    from,
    ...fields,
  };
  if (secret !== undefined) {
    result.publishOptionsSecret = secret;
  }
  return result;
}

function readSummaryFields(
  notification: PushXmppElement,
): Pick<PushNotification, 'messageCount' | 'lastMessageSender' | 'lastMessageBody'> | undefined {
  const forms = notification.getChildren('x', DATA_FORMS_NAMESPACE);
  if (forms.length === 0) {
    return {};
  }
  const summary = forms.find((form) => formTypeOf(form) === PUSH_SUMMARY_FORM_TYPE);
  if (summary === undefined) {
    return undefined;
  }
  const result: Pick<PushNotification, 'messageCount' | 'lastMessageSender' | 'lastMessageBody'> =
    {};
  const count = readField(summary, 'message-count');
  if (count !== undefined) {
    result.messageCount = count;
  }
  const sender = readField(summary, 'last-message-sender');
  if (sender !== undefined) {
    result.lastMessageSender = sender;
  }
  const body = readField(summary, 'last-message-body');
  if (body !== undefined) {
    result.lastMessageBody = body;
  }
  return result;
}

function formTypeOf(form: PushXmppElement): string | undefined {
  for (const field of form.getChildren('field')) {
    if (field.attrs['var'] === 'FORM_TYPE') {
      return field.getChildText('value') ?? undefined;
    }
  }
  return undefined;
}

function readField(form: PushXmppElement, name: string): string | undefined {
  for (const field of form.getChildren('field')) {
    if (field.attrs['var'] === name) {
      return field.getChildText('value') ?? undefined;
    }
  }
  return undefined;
}

function readPublishOption(options: PushXmppElement, name: string): string | undefined {
  for (const form of options.getChildren('x', DATA_FORMS_NAMESPACE)) {
    const value = readField(form, name);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}
