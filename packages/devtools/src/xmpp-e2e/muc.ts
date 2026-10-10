// Members-only MUC room joins for the XMPP end-to-end spike.
import { xml, type XmppClient, type XmppElement } from '@xmpp/client';
import { STEP_TIMEOUT_MS, withDeadline, xmppErrorCondition } from './harness';

const MUC_NAMESPACE = 'http://jabber.org/protocol/muc';

export function waitForPresence(
  xmpp: XmppClient,
  roomJid: string,
  expected: 'available' | 'error',
  description: string,
): Promise<XmppElement> {
  const deadline = withDeadline<XmppElement>(
    STEP_TIMEOUT_MS,
    () => new Error(`timed out waiting for ${description}`),
  );

  xmpp.on('stanza', (stanza: XmppElement) => {
    if (deadline.settled() || !stanza.is('presence')) return;
    if (!(stanza.attrs['from'] ?? '').startsWith(`${roomJid}/`)) return;
    const type = stanza.attrs['type'];
    if (type === 'error') {
      if (expected === 'error') {
        deadline.resolve(stanza);
      } else {
        deadline.reject(new Error(`the room rejected the join: ${xmppErrorCondition(stanza)}`));
      }
      return;
    }
    if (type === undefined && expected === 'available') {
      deadline.resolve(stanza);
    }
  });

  return deadline.promise;
}

// When expected is "error", resolves with the error condition ejabberd sent.
export async function joinRoom(
  xmpp: XmppClient,
  roomJid: string,
  nick: string,
  expected: 'available' | 'error',
): Promise<string | undefined> {
  const presence = waitForPresence(xmpp, roomJid, expected, `join of ${roomJid}`);
  await xmpp.send(
    xml('presence', { to: `${roomJid}/${nick}` }, xml('x', { xmlns: MUC_NAMESPACE })),
  );
  const stanza = await presence;
  return expected === 'error' ? xmppErrorCondition(stanza) : undefined;
}
