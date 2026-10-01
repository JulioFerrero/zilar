// Type declarations for `@xmpp/component` 0.14, which ships no TypeScript
// declarations. Only the surface the push service uses is described, so keep
// this file in sync with what `push/` actually calls. The element type is
// structural on purpose: the server must not depend on `@xmpp/client` (that
// package belongs to `xmpp-core`), and the real component's elements satisfy
// this shape at runtime.
//
// This file must stay a script (no top-level imports): with a top-level
// import the `declare module` below would become an augmentation and the
// package would stay untyped.
declare module '@xmpp/component' {
  export type PushXmppElement = {
    is(name: string): boolean;
    attrs: Record<string, string | undefined>;
    getChild(name: string, xmlns?: string): PushXmppElement | undefined;
    getChildren(name: string, xmlns?: string): PushXmppElement[];
    getChildText(name: string): string | undefined;
    getName(): string;
    getChildElements(): PushXmppElement[];
    text(): string;
  };

  export function xml(
    name: string,
    attrs?: Record<string, unknown> | string,
    ...children: Array<PushXmppElement | string>
  ): PushXmppElement;

  export function jid(value: string): { toString(): string; bare(): unknown };

  export type PushComponentAddress = {
    toString(): string;
  };

  export type PushComponentEvents = {
    online: (address: PushComponentAddress) => void;
    offline: () => void;
    error: (error: Error) => void;
    stanza: (stanza: PushXmppElement) => void;
  };

  export type PushComponent = {
    status: string;
    on(
      event: keyof PushComponentEvents,
      listener: PushComponentEvents[keyof PushComponentEvents],
    ): PushComponent;
    start(): Promise<unknown>;
    stop(): Promise<unknown>;
    send(stanza: PushXmppElement): Promise<void>;
  };

  export type PushComponentFactory = (options: {
    service: string;
    domain: string;
    password: string;
  }) => PushComponent;

  export function component(options: {
    service: string;
    domain: string;
    password: string;
  }): PushComponent;
}
