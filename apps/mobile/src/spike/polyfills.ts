// Minimal global shims xmpp.js needs to run on Hermes / React Native.
//
// Everything here is conditional: it only fills a gap when the runtime does not
// already provide the value, so it is safe to import on any platform. The spike
// screen logs, at startup, which of these ended up being polyfilled, which is
// the empirical evidence the task asks for.
//
// `events` is NOT polyfilled here: `@xmpp/events` declares it as a real npm
// dependency, so Metro resolves it from the package's own node_modules.

type PolyfilledGlobal = {
  process?: { nextTick?: (callback: () => void) => void };
  btoa?: (input: string) => string;
  atob?: (input: string) => string;
  crypto?: {
    randomUUID?: () => string;
    getRandomValues?: <T extends Uint8Array>(array: T) => T;
  };
};

const g = globalThis as unknown as PolyfilledGlobal;

const nativeBeforeInstall = {
  nextTick: typeof g.process?.nextTick === 'function',
  btoa: typeof g.btoa === 'function',
  atob: typeof g.atob === 'function',
  randomUUID: typeof g.crypto?.randomUUID === 'function',
  textEncoder: typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === 'function',
};

// Which capabilities the runtime provided on its own, before these shims ran.
// The spike screen prints this so the polyfill list in the Report is backed by
// evidence rather than guesswork.
export function nativeCapabilities(): typeof nativeBeforeInstall {
  return nativeBeforeInstall;
}

function installNextTick(): void {
  const process = (g.process ??= {});
  if (typeof process.nextTick === 'function') return;
  process.nextTick = (callback: () => void) => {
    // Hermes has no setImmediate; a microtask is a close enough "next tick".
    Promise.resolve().then(callback);
  };
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// btoa/atob over byte strings (char codes 0-255), matching the web API for the
// inputs xmpp.js feeds them (SASL responses are UTF-8 text of that range).
export function btoaPolyfill(input: string): string {
  const bytes = new Uint8Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    bytes[index] = input.charCodeAt(index) & 0xff;
  }
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const b0 = bytes[index] ?? 0;
    const b1 = bytes[index + 1];
    const b2 = bytes[index + 2];
    const triple = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    out += BASE64_ALPHABET[(triple >> 18) & 63];
    out += BASE64_ALPHABET[(triple >> 12) & 63];
    out += b1 === undefined ? '=' : BASE64_ALPHABET[(triple >> 6) & 63];
    out += b2 === undefined ? '=' : BASE64_ALPHABET[triple & 63];
  }
  return out;
}

export function atobPolyfill(input: string): string {
  const clean = input.replace(/=+$/, '');
  const padding = input.length - clean.length;
  let out = '';
  for (let index = 0; index < clean.length; index += 4) {
    const c0 = BASE64_ALPHABET.indexOf(clean[index] ?? '');
    const c1 = BASE64_ALPHABET.indexOf(clean[index + 1] ?? '');
    const c2 = BASE64_ALPHABET.indexOf(clean[index + 2] ?? '');
    const c3 = BASE64_ALPHABET.indexOf(clean[index + 3] ?? '');
    const value = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    out += String.fromCharCode((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
  }
  return padding === 0 ? out : out.slice(0, out.length - padding);
}

function installBase64(): void {
  if (typeof g.btoa !== 'function') g.btoa = btoaPolyfill;
  if (typeof g.atob !== 'function') g.atob = atobPolyfill;
}

export function randomUuid(): string {
  // Generates a v4 UUID directly; the value is only used as the client's
  // user-agent id, so cryptographic strength is not required. Must not call
  // `crypto.randomUUID` here — this function *is* the polyfill for it.
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
installBase64();
installCrypto();
