import { Effect, Schema } from 'effect';

// The push handle stored at this device (T-0119): a JSON `{ id, node }` in
// localStorage, read and written through the narrow surface below.

const DEVICE_KEY = 'zilar:pushDevice';

export interface StoredDevice {
  id: string;
  node: string;
}

// The stored handle is a JSON object with a string id and node; anything else reads as none.
const decodeStoredDevice = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ id: Schema.String, node: Schema.String })),
);

/** Reads the stored handle at this sync edge. A blocked or corrupt storage reads as none. */
export function readStoredDevice(): StoredDevice | null {
  return Effect.runSync(
    Effect.try(() => {
      const raw = window.localStorage.getItem(DEVICE_KEY);
      return raw === null ? null : decodeStoredDevice(raw);
    }).pipe(Effect.orElseSucceed(() => null)),
  );
}

export function writeStoredDevice(device: StoredDevice | null): void {
  // A blocked storage must never break the page.
  Effect.runSync(
    Effect.try(() => {
      if (device === null) {
        window.localStorage.removeItem(DEVICE_KEY);
      } else {
        window.localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
      }
    }).pipe(Effect.orElseSucceed(() => undefined)),
  );
}
