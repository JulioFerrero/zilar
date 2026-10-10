// effect-plain: runtime polyfills; nextTick must stay a Promise microtask
// Minimal global shims that xmpp.js needs on Hermes / React Native. Task T-0004
// proved exactly two are required: `process.nextTick` and
// `crypto.randomUUID`. Both are installed only when the runtime lacks them, so
// importing this is safe on any platform.
//
// Hermes already provides `btoa`/`atob`/`TextEncoder`, so they are not shimmed
// here. `events` is a real transitive dependency of `@xmpp/events`.
//
// T-0864: Effect's HTTP client decodes every response body with
// `new TextDecoder()`, which Hermes itself lacks. Expo's runtime installs one
// on native before app code runs, so the UTF-8 decoder below is a fallback
// for a runtime without either.

type Shimmable = {
  process?: { nextTick?: (callback: () => void) => void };
  crypto?: {
    randomUUID?: () => string;
    getRandomValues?: <T extends Uint8Array>(array: T) => T;
  };
  TextDecoder?: unknown;
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

const REPLACEMENT = 0xfffd;
const CHUNK = 0x2000;

function codeUnitsOf(bytes: Uint8Array): number[] {
  const units: number[] = [];
  // A leading byte-order mark is dropped, like the default `TextDecoder`.
  let index = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (index < bytes.length) {
    const lead = bytes[index]!;
    if (lead < 0x80) {
      units.push(lead);
      index += 1;
      continue;
    }
    // The WHATWG decoder: the sequence length and the valid range of the
    // first continuation byte follow from the lead byte.
    let needed = 0;
    let point = 0;
    let lower = 0x80;
    let upper = 0xbf;
    if (lead >= 0xc2 && lead <= 0xdf) {
      needed = 1;
      point = lead & 0x1f;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      needed = 2;
      point = lead & 0x0f;
      if (lead === 0xe0) lower = 0xa0;
      if (lead === 0xed) upper = 0x9f;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      needed = 3;
      point = lead & 0x07;
      if (lead === 0xf0) lower = 0x90;
      if (lead === 0xf4) upper = 0x8f;
    } else {
      units.push(REPLACEMENT);
      index += 1;
      continue;
    }
    let seen = 1;
    for (; seen <= needed; seen += 1) {
      const next = bytes[index + seen];
      if (next === undefined || next < lower || next > upper) break;
      point = (point << 6) | (next & 0x3f);
      lower = 0x80;
      upper = 0xbf;
    }
    if (seen <= needed) {
      // A broken sequence is one U+FFFD; the byte that broke it is read again.
      units.push(REPLACEMENT);
      index += seen;
      continue;
    }
    if (point > 0xffff) {
      point -= 0x10000;
      units.push(0xd800 + (point >> 10), 0xdc00 + (point & 0x3ff));
    } else {
      units.push(point);
    }
    index += needed + 1;
  }
  return units;
}

/** A UTF-8-only `TextDecoder` (non-fatal, non-streaming): this is that polyfill. */
export class Utf8TextDecoder {
  readonly encoding = 'utf-8';
  readonly fatal = false;
  readonly ignoreBOM = false;

  constructor(label = 'utf-8') {
    if (!/^(unicode-1-1-)?utf-?8$/i.test(label.trim())) {
      throw new RangeError(`Unsupported encoding: ${label}`);
    }
  }

  decode(input?: ArrayBuffer | ArrayBufferView): string {
    const bytes =
      input === undefined
        ? new Uint8Array(0)
        : ArrayBuffer.isView(input)
          ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
          : new Uint8Array(input);
    const units = codeUnitsOf(bytes);
    let text = '';
    for (let start = 0; start < units.length; start += CHUNK) {
      text += String.fromCharCode(...units.slice(start, start + CHUNK));
    }
    return text;
  }
}

function installTextDecoder(): void {
  if (typeof g.TextDecoder !== 'function') g.TextDecoder = Utf8TextDecoder;
}

installNextTick();
installCrypto();
installTextDecoder();
