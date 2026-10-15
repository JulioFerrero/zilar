// The owner's `@handle` for a pack, shared by the pack link, the panel list and
// Discover. The viewer's own row uses the signed-in handle; a known seed person
// uses the handle T-1520 gave every human; an unknown owner has none.
import type { MockData } from '../../state';
import { personHandle } from '../handles/check';

/** The owner's handle, from the viewer row or a seed person, else null. */
export function ownerHandle(data: MockData, ownerId: string): string | null {
  if (ownerId === data.me.id) {
    return data.me.handle;
  }
  const person = data.people.find((entry) => entry.id === ownerId);
  return person === undefined ? null : personHandle(data, person.id);
}
