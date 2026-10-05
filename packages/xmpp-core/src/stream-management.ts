import type { XmppClient, XmppElement } from '@xmpp/client';

// XEP-0198 stream management, as used by @xmpp/client 0.14.
//
// xmpp.js keeps its own inbound counter (`streamManagement.inbound`) and puts it
// in every <a h="…"/> it sends. That counter has two problems over WebSocket:
//
//   1. it counts stanzas that arrive *before* <enabled/> (the middleware
//      increments for every presence/message/iq from the very first element),
//      and the correction only happens in `enabled()`, which is asynchronous;
//   2. our client sends its initial <presence/> before xmpp.js sends <enable/>,
//      so the server echoes a presence that it sent while stream management was
//      still inactive (not counted by the server).
//
// When <enabled/>, a pre-enable stanza and the server's first <r/> can arrive
// in the same parser batch: xmpp.js then acknowledges the pre-enable stanza
// (`<a h="2"/>` while the server sent one) and ejabberd closes the session with
// "Client acknowledged more stanzas than sent by server".
//
// This counter follows XEP-0198 §4 exactly: it starts at zero after <enabled/>
// (and continues after <resumed/>), counts only message/presence/iq, and is the
// value written into the outgoing <a/> and <resume/> elements.
export const STREAM_MANAGEMENT_NS = 'urn:xmpp:sm:3';

const COUNTED_STANZAS = new Set(['message', 'presence', 'iq']);

export type StreamManagementAck = {
  /** Stanzas handled since stream management was (re)enabled. */
  inbound(): number;
  /** Whether <enabled/> or <resumed/> has been seen. */
  counting(): boolean;
  /** Feeds one incoming element (stanza or nonza) into the counter. */
  observe(element: XmppElement): void;
  /** Stops counting new stanzas without losing the current value (disconnect). */
  stop(): void;
  /** Rewrites the `h` of an outgoing <a/> or <resume/> with the true count. */
  correctOutgoing(element: XmppElement): void;
};

export function createStreamManagementAck(): StreamManagementAck {
  let inbound = 0;
  let active = false;
  return {
    inbound: () => inbound,
    counting: () => active,
    observe(element) {
      if (element.is('enabled', STREAM_MANAGEMENT_NS)) {
        // "The counter for the received stanzas ('h') is set to zero and
        // started after receiving either <enable/> or <enabled/>."
        inbound = 0;
        active = true;
        return;
      }
      if (element.is('resumed', STREAM_MANAGEMENT_NS)) {
        // Resumption continues the previous counter.
        active = true;
        return;
      }
      if (active && COUNTED_STANZAS.has(element.name)) {
        inbound += 1;
      }
    },
    stop() {
      active = false;
    },
    correctOutgoing(element) {
      if (element.is('a', STREAM_MANAGEMENT_NS) || element.is('resume', STREAM_MANAGEMENT_NS)) {
        element.attrs.h = String(inbound);
      }
    },
  };
}

// Installs the corrected counter on a client created by @xmpp/client. It reads
// every incoming element, patches the `h` of the outgoing <a/> and <resume/>
// elements, and does nothing when the client has no stream management
// (unit tests use a small fake without it).
export function installStreamManagementAck(client: XmppClient): void {
  const sm = (client as XmppClient & { streamManagement?: unknown }).streamManagement;
  if (sm === undefined || sm === null) return;

  const ack = createStreamManagementAck();
  client.on('element', (element) => {
    ack.observe(element);
  });
  client.on('disconnect', () => {
    ack.stop();
  });
  client.on('offline', () => {
    ack.stop();
  });

  const send = client.send.bind(client);
  client.send = (element) => {
    ack.correctOutgoing(element);
    return send(element);
  };
}
