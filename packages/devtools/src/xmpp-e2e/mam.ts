// Room history (MAM) queries for the XMPP end-to-end spike.
import { xml, type XmppClient, type XmppElement } from '@xmpp/client';
import { errorMessage, STEP_TIMEOUT_MS, withDeadline, xmppErrorCondition } from './harness';

const MAM_NAMESPACE = 'urn:xmpp:mam:2';
const FORWARD_NAMESPACE = 'urn:xmpp:forward:0';
const DELAY_NAMESPACE = 'urn:xmpp:delay';
const DATA_FORMS_NAMESPACE = 'jabber:x:data';

export type MamMessage = { body: string; timestamp: string };

export function queryRoomMam(
  xmpp: XmppClient,
  roomJid: string,
  queryId: string,
): Promise<MamMessage[]> {
  const iqId = `mam-${queryId}`;
  const messages: MamMessage[] = [];

  const deadline = withDeadline<MamMessage[]>(
    STEP_TIMEOUT_MS,
    () => new Error(`timed out waiting for the MAM result of ${roomJid}`),
  );

  xmpp.on('stanza', (stanza: XmppElement) => {
    if (deadline.settled()) return;
    if (stanza.is('message')) {
      const result = stanza.getChild('result', MAM_NAMESPACE);
      if (result === undefined || result.attrs['queryid'] !== queryId) return;
      const forwarded = result.getChild('forwarded', FORWARD_NAMESPACE);
      const body = forwarded?.getChild('message')?.getChildText('body') ?? '';
      const timestamp = forwarded?.getChild('delay', DELAY_NAMESPACE)?.attrs['stamp'] ?? '';
      if (body !== '') {
        messages.push({ body, timestamp });
      }
      return;
    }
    if (stanza.is('iq') && stanza.attrs['id'] === iqId) {
      if (stanza.attrs['type'] === 'error') {
        deadline.reject(new Error(`MAM query to ${roomJid} failed: ${xmppErrorCondition(stanza)}`));
      } else {
        deadline.resolve(messages);
      }
    }
  });

  xmpp
    .send(
      xml(
        'iq',
        { type: 'set', id: iqId, to: roomJid },
        xml(
          'query',
          { xmlns: MAM_NAMESPACE, queryid: queryId },
          xml(
            'x',
            { xmlns: DATA_FORMS_NAMESPACE, type: 'submit' },
            xml('field', { var: 'FORM_TYPE', type: 'hidden' }, xml('value', {}, MAM_NAMESPACE)),
          ),
        ),
      ),
    )
    .catch((error: unknown) => {
      deadline.reject(new Error(`could not send the MAM query: ${errorMessage(error)}`));
    });

  return deadline.promise;
}
