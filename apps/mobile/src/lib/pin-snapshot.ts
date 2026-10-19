/**
 * Dependency-free, so components import it without pulling the API client.
 */

/** A pin `kind` this build does not know decodes to `text`. */
export type SnapshotPinKind = 'text' | 'image' | 'file' | 'voice' | 'card';

const PIN_KIND_LABEL: Record<SnapshotPinKind, string> = {
  text: '',
  image: 'Photo',
  file: 'File',
  voice: 'Voice message',
  card: 'Card',
};

export function pinLabel(pin: { text: string; kind: SnapshotPinKind }): string {
  const text = pin.text.trim();
  if (text !== '') {
    return text;
  }
  return PIN_KIND_LABEL[pin.kind] ?? 'Pinned message';
}
