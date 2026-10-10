import type { MockSeed } from '../../data';
import type { MockData } from '../../state';
import type { MockPin } from './tables';

/**
 * The pins table. Rows are cloned from the seed, so a caller-supplied seed is
 * never changed; pin and unpin replace the array, never mutate in place.
 */
export function createPinsState(seed: MockSeed): Partial<MockData> {
  let pins: MockPin[] = seed.pins.map((pin) => ({ ...pin }));
  let pinSequence = 1;
  return {
    get pins(): readonly MockPin[] {
      return pins;
    },
    findPin(id: string): MockPin | undefined {
      return pins.find((pin) => pin.id === id);
    },
    putPin(pin: MockPin): void {
      pins = [pin, ...pins];
    },
    removePin(id: string): void {
      pins = pins.filter((pin) => pin.id !== id);
    },
    nextPinId(): string {
      const id = `pin-mock-${pinSequence}`;
      pinSequence += 1;
      return id;
    },
  };
}
