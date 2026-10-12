// The live delivered mark one of my own devices receives (T-1245). The server
// sends a bodiless headline from my own bare JID to each of my resources; the
// event joins the map through interface merging, like the ack events in
// `types-ack.ts`, so `types.ts` keeps its size.

/** One delivered mark of my own messages, pushed live to this device. */
export interface DeliveredMarkEvent {
  /** The DM chat id in my terms: the confirming peer's bare JID. */
  chatJid: string;
  /** The archive id the mark moved to, in my own-message terms. */
  until: string;
}

declare module './events' {
  interface EventPayloadMap {
    deliveredMark: DeliveredMarkEvent;
  }
}

declare module './types' {
  interface XmppCore {
    /**
     * A delivered mark of one of my messages moved forward (T-1245): the
     * server told this device directly. Fires only for a headline from my own
     * bare JID.
     */
    on(event: 'deliveredMark', cb: (e: DeliveredMarkEvent) => void): () => void;
  }
}
