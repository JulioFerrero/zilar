// Ambient types for @xmpp/client 0.14, which ships no TypeScript declarations.
// `@zilar/xmpp-core` ships the same declaration inside its own project, but
// the mobile app's tsc program does not include that file, so this copy makes
// the imported xmpp-core source type-check here too. Mirrors
// packages/xmpp-core/src/types/xmpp.d.ts.
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

  export type XmppStatus =
    | 'offline'
    | 'connecting'
    | 'connect'
    | 'connected'
    | 'opening'
    | 'open'
    | 'online'
    | 'closing'
    | 'close'
    | 'disconnecting'
    | 'disconnect';

  export type XmppCredentials = {
    username?: string;
    password?: string;
    token?: unknown;
  };

  export type XmppAuthenticate = (
    credentials: XmppCredentials,
    mechanism?: string,
  ) => Promise<void>;

  export type XmppCredentialsProvider = (
    authenticate: XmppAuthenticate,
    mechanisms: string[],
  ) => Promise<void>;

  export type XmppReconnect = {
    delay: number;
    on(event: 'reconnecting', listener: () => void): XmppReconnect;
    on(event: 'reconnected', listener: () => void): XmppReconnect;
  };

  export type XmppClient = {
    jid: XmppJid | null;
    status: XmppStatus;
    reconnect: XmppReconnect;
    start(): Promise<unknown>;
    stop(): Promise<unknown>;
    disconnect(): Promise<unknown>;
    send(stanza: XmppElement): Promise<void>;
    sendMany(stanzas: XmppElement[]): Promise<void>;
    on(event: 'online', listener: (jid: XmppJid) => void): XmppClient;
    on(event: 'offline', listener: () => void): XmppClient;
    on(event: 'disconnect', listener: () => void): XmppClient;
    on(event: 'error', listener: (error: Error) => void): XmppClient;
    on(event: 'element', listener: (element: XmppElement) => void): XmppClient;
    on(event: 'send', listener: (element: XmppElement) => void): XmppClient;
    on(event: 'stanza', listener: (stanza: XmppElement) => void): XmppClient;
    on(event: 'status', listener: (status: XmppStatus) => void): XmppClient;
    on(event: string, listener: (...args: never[]) => void): XmppClient;
    removeListener(event: string, listener: (...args: never[]) => void): XmppClient;
  };

  export function xml(
    name: string,
    attrs?: Record<string, unknown> | string,
    ...children: Array<XmppElement | string>
  ): XmppElement;

  export function jid(value: string): XmppJid;

  export function client(options: {
    service?: string;
    domain?: string;
    username?: string;
    password?: string;
    resource?: string;
    credentials?: XmppCredentialsProvider;
  }): XmppClient;
}
