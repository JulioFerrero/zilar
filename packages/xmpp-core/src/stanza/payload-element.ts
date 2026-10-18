import { xml, type XmppElement } from '@xmpp/client';
import { encodePayload, type Payload } from '@zilar/protocol';
import { AGENT_NAMESPACE, HINTS_NAMESPACE } from '../namespaces';

export function pushPayloadElement(children: XmppElement[], payload: Payload | undefined): void {
  if (payload === undefined) {
    return;
  }
  children.push(xml('agent', { xmlns: AGENT_NAMESPACE }, encodePayload(payload)));
  children.push(xml('store', { xmlns: HINTS_NAMESPACE }));
}
