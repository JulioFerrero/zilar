import type { Pin } from '../lib/pins-api';

/**
 * The in-memory pins of mock mode (T-0135): the mock store works without a
 * server, so pins live here like the web mock's in-memory pins. Seeds: one
 * text pin in the Ana DM, one photo pin in Viernes 🍻 (like the web mock).
 */

function seed(now: Date): Pin[] {
  return [
    {
      id: 'pin-ana-1',
      chat: 'ana',
      messageId: 'ana-11',
      senderName: 'You',
      text: 'Booked for 21:00 ✅',
      kind: 'text',
      pinnedBy: 'me',
      pinnedAt: now.toISOString(),
    },
    {
      id: 'pin-viernes-1',
      chat: 'viernes',
      messageId: 'viernes-08',
      senderName: 'Marta',
      text: '',
      kind: 'image',
      pinnedBy: 'me',
      pinnedAt: now.toISOString(),
    },
  ];
}

let pins: Pin[] = seed(new Date());
let counter = 0;

/** Resets the mock pins, so tests start from the same seeded state. */
export function resetMockPins(now: Date = new Date()): void {
  pins = seed(now);
  counter = 0;
}

export function mockListPins(chat: string): Pin[] {
  return pins
    .filter((pin) => pin.chat.toLowerCase() === chat.toLowerCase())
    .map((pin) => ({ ...pin }));
}

/** Pins a message in memory; a second pin of the same message answers it. */
export function mockPinMessage(
  input: { chat: string; messageId: string; senderName: string; text: string; kind: Pin['kind'] },
  now: Date = new Date(),
): Pin {
  const existing = pins.find(
    (pin) =>
      pin.chat.toLowerCase() === input.chat.toLowerCase() && pin.messageId === input.messageId,
  );
  if (existing !== undefined) {
    return { ...existing };
  }
  counter += 1;
  const pin: Pin = {
    id: `pin-mock-${counter}`,
    chat: input.chat,
    messageId: input.messageId,
    senderName: input.senderName,
    text: input.text,
    kind: input.kind,
    pinnedBy: 'me',
    pinnedAt: now.toISOString(),
  };
  // Newest first, like the server (the real store prepends too): the banner
  // always shows the latest pin.
  pins = [pin, ...pins];
  return { ...pin };
}

/** Unpins by id, echoing the removed row like the server. */
export function mockUnpinMessage(id: string): Pin | undefined {
  const pin = pins.find((entry) => entry.id === id);
  if (pin === undefined) {
    return undefined;
  }
  pins = pins.filter((entry) => entry.id !== id);
  return { ...pin };
}
