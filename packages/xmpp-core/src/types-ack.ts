// The stream-management delivery events the core exposes (F4, honest ticks).
//
// The stanza ids the library itself confirms or loses: `acked` fires when the
// server acknowledges an outgoing `<message/>` stanza over stream management
// (XEP-0198), `unacked` when the library drops the stanza without an ack (a
// failed resume or a dead stream). Both carry the stanza's `id` attribute,
// which is the id `sendMessage` returned, so the sender can match its bubble.
//
// `types.ts` is shared with another task and has a 400-line cap, so the two
// `on(...)` overloads and the first-watchdog-step option live here as module
// augmentations; `types.ts` keeps exactly one line (the re-export below).

// `XmppCore`/`XmppCoreOptions` are referenced only inside the augmentations
// below, so no value or type import is needed here.

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

// `EventName` and the `on`/`emit` signatures widen automatically once the
// map above names the two events. These overloads name them too, so editor
// completion sees them on `XmppCore` directly.
declare module './types' {
  interface XmppCoreOptions {
    /**
     * The first watchdog wait in ms. When set, the first replacement of a
     * stuck client happens after this long, then the schedule above (or
     * `reconnectWatchdogMs`) takes over for the later steps. Mobile passes
     * 15 000, so a slow network gets one long chance before the client (and
     * the stream-management resume it would have attempted) is replaced.
     */
    reconnectWatchdogFirstMs?: number;
  }
  interface XmppCore {
    /**
     * Stream management confirmed an outgoing stanza reached the server
     * (XEP-0198 `ack`): the sender marks its bubble `sent`. Fires with the
     * stanza `id`.
     */
    on(event: 'acked', cb: (e: StreamAckEvent) => void): () => void;
    /**
     * Stream management lost an outgoing stanza without an ack (XEP-0198
     * `fail`, e.g. a dead stream): the sender requeues its bubble in the
     * outbox. Fires with the stanza `id`.
     */
    on(event: 'unacked', cb: (e: StreamAckEvent) => void): () => void;
  }
}

// This augmentation (with the option above) is why `types.ts` needs no more
// than its one re-export line for the two events.
export type AckEventName = 'acked' | 'unacked';
