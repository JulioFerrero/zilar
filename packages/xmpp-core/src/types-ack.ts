// The stanza ids the library confirms or loses: `acked` when the server acks an
// outgoing `<message/>` over XEP-0198, `unacked` when the library drops it without an
// ack. Both carry the stanza `id` `sendMessage` returned, so the sender can match its
// bubble. The overloads and the first-watchdog option live here to keep `types.ts` small.

/** The id (stanza `id` attribute) the library confirmed (`acked`) or lost (`unacked`). */
export type StreamAckEvent = {
  stanzaId: string;
};

declare module './events' {
  interface EventPayloadMap {
    acked: StreamAckEvent;
    unacked: StreamAckEvent;
  }
}

// The overloads name the two events too, so editor completion sees them on `XmppCore`.
declare module './types' {
  interface XmppCoreOptions {
    /**
     * The first watchdog wait in ms; then the schedule above (or `reconnectWatchdogMs`)
     * takes over. Mobile passes 15 000, so a slow network gets one long chance before the
     * client and its resume attempt are replaced.
     */
    reconnectWatchdogFirstMs?: number;
  }
  interface XmppCore {
    /** Stream management confirmed an outgoing stanza (XEP-0198 `ack`): mark the bubble
     * `sent`. Fires with the stanza `id`. */
    on(event: 'acked', cb: (e: StreamAckEvent) => void): () => void;
    /** Stream management lost an outgoing stanza without an ack (XEP-0198 `fail`): requeue
     * the bubble. Fires with the stanza `id`. */
    on(event: 'unacked', cb: (e: StreamAckEvent) => void): () => void;
  }
}
