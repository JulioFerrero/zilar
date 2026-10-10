import type { MockSeed } from '../../data';
import type { MockData } from '../../state';
import type { MockPushDevice } from './tables';

/**
 * The push-device table and the previews setting. Rows are cloned from the
 * seed, so a caller-supplied seed is never changed; a write replaces the array
 * or the boolean, never mutates in place.
 */
export function createPushState(seed: MockSeed): Partial<MockData> {
  let pushDevices: MockPushDevice[] = seed.pushDevices.map((device) => ({ ...device }));
  let pushShowPreviews = seed.pushShowPreviews;
  let pushDeviceSequence = 1;
  return {
    get pushDevices(): readonly MockPushDevice[] {
      return pushDevices;
    },
    get pushShowPreviews(): boolean {
      return pushShowPreviews;
    },
    findPushDevice(id: string): MockPushDevice | undefined {
      return pushDevices.find((device) => device.id === id);
    },
    putPushDevice(device: MockPushDevice): void {
      pushDevices = pushDevices.some((item) => item.id === device.id)
        ? pushDevices.map((item) => (item.id === device.id ? device : item))
        : [...pushDevices, device];
    },
    removePushDevice(id: string): void {
      pushDevices = pushDevices.filter((device) => device.id !== id);
    },
    setPushShowPreviews(show: boolean): void {
      pushShowPreviews = show;
    },
    nextPushDeviceId(): string {
      const id = `mock-push-device-${pushDeviceSequence}`;
      pushDeviceSequence += 1;
      return id;
    },
  };
}
