// Minimal ambient types for @xmpp/client 0.14, which ships no TypeScript
// declarations. Only the surface the end-to-end script uses is described.
declare module '@xmpp/client' {
  export type XmppElement = {
    name: string;
    attrs: Record<string, string | undefined>;
    children: Array<XmppElement | string>;
    parent: XmppElement | null;
    is(name: string, xmlns?: string): boolean;
    getName(): string;
    getNS(): string | undefined;
    getAttr(name: string, xmlns?: string): string | undefined;
    getChild(name: string, xmlns?: string): XmppElement | undefined;
    getChildren(name?: string, xmlns?: string): XmppElement[];
    getChildText(name: string, xmlns?: string): string | null;
    getChildElements(): XmppElement[];
    getText(): string;
    text(): string;
    toString(): string;
  };

  export type XmppJid = {
    toString(): string;
    bare(): XmppJid;
  };

  export type XmppClient = {
    jid: XmppJid | null;
    status: string;
    start(): Promise<unknown>;
    stop(): Promise<unknown>;
    send(stanza: XmppElement): Promise<void>;
    on(event: 'online', listener: (jid: XmppJid) => void): XmppClient;
    on(event: 'offline', listener: () => void): XmppClient;
    on(event: 'error', listener: (error: Error) => void): XmppClient;
    on(event: 'stanza', listener: (stanza: XmppElement) => void): XmppClient;
    on(event: string, listener: (...args: never[]) => void): XmppClient;
  };

  export function xml(
    name: string,
    attrs?: Record<string, unknown> | string,
    ...children: Array<XmppElement | string>
  ): XmppElement;

  export function client(options: {
    service?: string;
    domain?: string;
    username?: string;
    password?: string;
    resource?: string;
  }): XmppClient;
}
