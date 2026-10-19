/**
 * Dependency-free, so components import it without pulling the API client.
 */

/** A pin `kind` this build does not know decodes to `text`. */
export type SnapshotPinKind = 'text' | 'image' | 'file' | 'voice' | 'card';

/**
 * Up to 300 chars of display-only text, or the attachment kind with empty text; a retracted original reads "Message deleted".
 */
export function pinKindFor(message: {
  text?: string;
  image?: unknown;
  voice?: unknown;
  card?: unknown;
  attachment?: unknown;
}): SnapshotPinKind {
  if (message.image !== undefined) return 'image';
  if (message.voice !== undefined) return 'voice';
  if (message.card !== undefined) return 'card';
  if (message.attachment !== undefined) return 'file';
  return 'text';
}

export function pinSnapshotText(message: {
  text?: string;
  deleted?: boolean;
  image?: unknown;
  voice?: unknown;
  card?: unknown;
  attachment?: unknown;
}): string {
  if (message.deleted === true) {
    return 'Message deleted';
  }
  if (pinKindFor(message) !== 'text') {
    return '';
  }
  return (message.text ?? '').slice(0, 300);
}

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
