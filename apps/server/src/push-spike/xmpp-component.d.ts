// Spike-only type declarations for `@xmpp/component` 0.14, which ships no
// TypeScript declarations. Only the surface the spike uses is described, so
// keep this file in sync with what push-spike actually calls.
//
// This file must stay a script (no top-level imports): with a top-level
// import the `declare module` below would become an augmentation and the
// package would stay untyped. Element types come from `import(...)` types,
// which do not make the file a module.
declare module '@xmpp/component' {
  export type XmppElement = import('@xmpp/client').XmppElement;

  export function xml(
    name: string,
    attrs?: Record<string, unknown> | string,
    ...children: Array<XmppElement | string>
  ): XmppElement;

  export function jid(value: string): { toString(): string; bare(): unknown };

  export type SpikeComponentAddress = {
    toString(): string;
  };

  export type SpikeComponentEvents = {
    online: (address: SpikeComponentAddress) => void;
    offline: () => void;
    error: (error: Error) => void;
    stanza: (stanza: import('@xmpp/client').XmppElement) => void;
  };

  export type SpikeComponent = {
    status: SpikeComponentStatus;
    on(
      event: keyof SpikeComponentEvents,
      listener: SpikeComponentEvents[keyof SpikeComponentEvents],
    ): SpikeComponent;
    start(): Promise<unknown>;
    stop(): Promise<unknown>;
    send(stanza: import('@xmpp/client').XmppElement): Promise<void>;
  };

  export type SpikeComponentFactory = (options: {
    service: string;
    domain: string;
    password: string;
  }) => SpikeComponent;

  export function component(options: {
    service: string;
    domain: string;
    password: string;
  }): SpikeComponent;
}
