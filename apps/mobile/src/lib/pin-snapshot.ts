/**
 * The display-only pin snapshot (T-0135), dependency-free so components can
 * import it without pulling the API client (which Vitest cannot resolve
 * for component modules — see `apps/mobile` test notes in T-0112).
 */

export type SnapshotPinKind = 'text' | 'image' | 'file' | 'voice' | 'card';

/**
 * The pin snapshot for a loaded message (T-0114): the sender name plus up to
 * 300 chars of display-only text, or the attachment kind with empty text.
 * A retracted original reads "Message deleted" once the retraction lands.
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

/** The display-only snapshot text: plain text (max 300), empty for kinds. */
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

/** The banner/list label for a pin: text, or the kind label for attachments. */
export function pinLabel(pin: { text: string; kind: SnapshotPinKind }): string {
  const text = pin.text.trim();
  if (text !== '') {
    return text;
  }
  return PIN_KIND_LABEL[pin.kind] ?? 'Pinned message';
}
