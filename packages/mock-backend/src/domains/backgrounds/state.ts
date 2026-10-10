import type { MockData } from '../../state';
import type { MockBackground } from './seed';

/**
 * The uploaded-backgrounds table. It starts empty, like web's mock; a POST
 * replaces the array and `nextBackgroundSequence` mints the `bg-mock-N` ids.
 */
export function createBackgroundsState(): Partial<MockData> {
  const backgrounds: MockBackground[] = [];
  return { backgrounds, nextBackgroundSequence: 1 };
}
