// Minimal global shims that xmpp.js needs on Hermes / React Native. Task T-0004
// proved exactly two are required: `process.nextTick` and
// `crypto.randomUUID`. Both are installed only when the runtime lacks them, so
// importing this is safe on any platform.
//
// Hermes already provides `btoa`/`atob`/`TextEncoder`, so they are not shimmed
// here. `events` is a real transitive dependency of `@xmpp/events`.

type Shimmable = {
  process?: { nextTick?: (callback: () => void) => void };
  crypto?: {
    randomUUID?: () => string;
    getRandomValues?: <T extends Uint8Array>(array: T) => T;
  };
};

const g = globalThis as unknown as Shimmable;

function installNextTick(): void {
  const process = (g.process ??= {});
  if (typeof process.nextTick === 'function') return;
  // Hermes has no setImmediate; a microtask is a close enough "next tick".
  process.nextTick = (callback: () => void) => {
    Promise.resolve().then(callback);
  };
}

/** A v4 UUID built without `crypto.randomUUID` (this is that polyfill). */
export function randomUuid(): string {
  const bytes = new Uint8Array(16);
  const getRandomValues = g.crypto?.getRandomValues;
  if (typeof getRandomValues === 'function') {
    getRandomValues.call(g.crypto, bytes);
  } else {
    for (let index = 0; index < 16; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function installCrypto(): void {
  const crypto = (g.crypto ??= {});
  if (typeof crypto.randomUUID !== 'function') crypto.randomUUID = randomUuid;
}

installNextTick();
installCrypto();
