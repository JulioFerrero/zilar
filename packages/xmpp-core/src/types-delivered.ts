// The live delivered mark one of my own devices receives: the server sends a bodiless
// headline from my own bare JID to each resource.

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
    /** A delivered mark of one of my messages moved forward, pushed live to this device. */
    on(event: 'deliveredMark', cb: (e: DeliveredMarkEvent) => void): () => void;
  }
}
