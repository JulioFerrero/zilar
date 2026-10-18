import type { XmppClient, XmppElement } from '@xmpp/client';

// XEP-0198, as used by @xmpp/client 0.14. xmpp.js's own inbound counter counts
// stanzas that arrive before `<enabled/>` and corrects only asynchronously, while our
// initial `<presence/>` goes out before `<enable/>`; in the same parser batch xmpp.js then
// acks that pre-enable stanza and ejabberd closes the session with "Client acknowledged more
// stanzas than sent by server". This counter follows the XEP: zero after `<enabled/>`,
// continuing after `<resumed/>`, counting only message/presence/iq.
export const STREAM_MANAGEMENT_NS = 'urn:xmpp:sm:3';

const COUNTED_STANZAS = new Set(['message', 'presence', 'iq']);

export type StreamManagementAck = {
  /** Stanzas handled since stream management was (re)enabled. */
  inbound(): number;
  counting(): boolean;
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

// Installs the corrected counter: reads every incoming element, patches the `h` of
// outgoing `<a/>`/`<resume/>`, and forwards the library's `ack`/`fail` for outgoing
// `<message/>` stanzas. Nothing when the client has no stream management.
export function installStreamManagementAck(
  client: XmppClient,
  handlers?: {
    onAcked?: (stanzaId: string) => void;
    onUnacked?: (stanzaId: string) => void;
    /** <enabled/> or <resumed/>: this stream now tracks outgoing stanzas. */
    onReady?: () => void;
  },
): void {
  const sm = (client as XmppClient & { streamManagement?: unknown }).streamManagement;
  if (sm === undefined || sm === null) return;

  const ack = createStreamManagementAck();
  client.on('element', (element) => {
    ack.observe(element);
    // A stream not (yet) managed tracks no outgoing stanza, so callers wait for this.
    if (
      element.is('enabled', STREAM_MANAGEMENT_NS) ||
      element.is('resumed', STREAM_MANAGEMENT_NS)
    ) {
      handlers?.onReady?.();
    }
  });
  client.on('disconnect', () => {
    ack.stop();
  });
  client.on('offline', () => {
    ack.stop();
  });

  // The library's middleware emits `ack` and `fail` with the stanza; only `<message/>`
  // with an `id` is reported.
  const report = (event: 'ack' | 'fail', stanza: XmppElement): void => {
    if (!stanza.is('message')) return;
    const id = stanza.attrs['id'];
    if (id === undefined) return;
    if (event === 'ack') {
      handlers?.onAcked?.(id);
    } else {
      handlers?.onUnacked?.(id);
    }
  };
  const emitter = sm as { on?: (event: string, listener: (stanza: XmppElement) => void) => void };
  emitter.on?.('ack', (stanza) => report('ack', stanza));
  emitter.on?.('fail', (stanza) => report('fail', stanza));

  const send = client.send.bind(client);
  client.send = (element) => {
    ack.correctOutgoing(element);
    return send(element);
  };
}
