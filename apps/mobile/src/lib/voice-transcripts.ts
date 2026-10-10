/**
 * On-device voice-note transcripts (T-0179): a single JSON file at
 * `Paths.document/voice-transcripts.json`, keyed by message id. The
 * transcripts never leave the phone and are never sent on the wire: the
 * protocol package is untouched, and the bubble keeps them as local state.
 */

import { Exit, Schema } from 'effect';
import { struct } from '@zilar/protocol';

/** One stored transcript: the text plus the detected language, if any. */
export const StoredTranscriptSchema = struct({
  text: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  language: Schema.optional(Schema.String),
});

export type StoredTranscript = typeof StoredTranscriptSchema.Type;

export type TranscriptMap = Record<string, StoredTranscript>;

export const TRANSCRIPTS_FILENAME = 'voice-transcripts.json';
/** At most this many transcripts are kept; older ones are dropped. */
export const MAX_STORED_TRANSCRIPTS = 500;
/** A single transcript is never stored longer than this. */
export const MAX_TRANSCRIPT_CHARS = 20_000;

/** The file seam: tests inject a fake, production uses `expo-file-system`. */
export interface TranscriptFile {
  read: () => Promise<string | null>;
  write: (raw: string) => Promise<void>;
}

async function defaultFile(): Promise<{
  file: {
    exists: boolean;
    create: () => void;
    text: () => Promise<string>;
    write: (content: string) => void;
  };
}> {
  const { File, Paths } = await import('expo-file-system');
  return { file: new File(Paths.document, TRANSCRIPTS_FILENAME) };
}

function defaultTranscriptFile(): TranscriptFile {
  return {
    read: async () => {
      const { file } = await defaultFile();
      if (!file.exists) {
        return null;
      }
      return file.text();
    },
    write: async (raw: string) => {
      const { file } = await defaultFile();
      if (!file.exists) {
        file.create();
      }
      file.write(raw);
    },
  };
}

/**
 * Parses the raw file content entry by entry (T-0179, round 1): valid
 * entries survive, only the invalid ones are dropped. A whole-file schema
 * check would wipe the cache because of one bad entry; here a hostile
 * entry never takes the good ones with it. Missing or unparsable data
 * resolves to {}.
 */
export function parseTranscripts(raw: string | null | undefined): TranscriptMap {
  if (raw === null || raw === undefined || raw === '') {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const kept: TranscriptMap = {};
  for (const [key, value] of Object.entries(parsed)) {
    const entry = Schema.decodeUnknownExit(StoredTranscriptSchema)(value);
    if (Exit.isSuccess(entry)) {
      kept[key] = entry.value;
    }
  }
  return kept;
}

/** Reads every stored transcript; a missing or hostile file resolves to {}. */
export async function readTranscripts(file?: TranscriptFile): Promise<TranscriptMap> {
  const backend = file ?? defaultTranscriptFile();
  try {
    return parseTranscripts(await backend.read());
  } catch {
    return {};
  }
}

/**
 * All writes run one at a time (T-0179, round 1): `saveTranscript` and
 * `deleteTranscript` each wait for the previous write, so two saves started
 * together never lose one to a stale read. A failed write never blocks
 * later ones. Reads stay unchained.
 */
let writeChain: Promise<void> = Promise.resolve();

function chainWrite(work: () => Promise<void>): Promise<void> {
  const next = writeChain.then(work, work);
  writeChain = next.catch(() => {});
  return next;
}

/**
 * Stores one transcript, capped at `MAX_TRANSCRIPT_CHARS` and
 * `MAX_STORED_TRANSCRIPTS` entries (oldest dropped). A failing storage
 * never breaks the chat: it resolves without throwing.
 */
export async function saveTranscript(
  id: string,
  entry: StoredTranscript,
  file?: TranscriptFile,
): Promise<void> {
  if (id === '') {
    return;
  }
  return chainWrite(async () => {
    await writeTranscript(id, entry, file);
  });
}

async function writeTranscript(
  id: string,
  entry: StoredTranscript,
  file?: TranscriptFile,
): Promise<void> {
  const backend = file ?? defaultTranscriptFile();
  let current: TranscriptMap = {};
  try {
    current = parseTranscripts(await backend.read());
  } catch {
    current = {};
  }
  const text = entry.text.slice(0, MAX_TRANSCRIPT_CHARS);
  if (text === '') {
    return;
  }
  const next: TranscriptMap = { ...current };
  delete next[id];
  next[id] = entry.language === undefined ? { text } : { text, language: entry.language };
  const keys = Object.keys(next);
  if (keys.length > MAX_STORED_TRANSCRIPTS) {
    for (const oldest of keys.slice(0, keys.length - MAX_STORED_TRANSCRIPTS)) {
      delete next[oldest as string];
    }
  }
  try {
    await backend.write(JSON.stringify(next));
  } catch {
    // A blocked storage must never break the chat.
  }
}

/**
 * Forgets every transcript (sign-out, T-0901): the file is plain text on the
 * phone and is not keyed by user. A failing storage resolves without throwing.
 */
export async function clearTranscripts(file?: TranscriptFile): Promise<void> {
  return chainWrite(async () => {
    const backend = file ?? defaultTranscriptFile();
    try {
      await backend.write('{}');
    } catch {
      // A blocked storage must never break sign-out.
    }
  });
}

/** Forgets one transcript; a failing storage resolves without throwing. */
export async function deleteTranscript(id: string, file?: TranscriptFile): Promise<void> {
  return chainWrite(async () => {
    const backend = file ?? defaultTranscriptFile();
    let current: TranscriptMap = {};
    try {
      current = parseTranscripts(await backend.read());
    } catch {
      return;
    }
    if (current[id] === undefined) {
      return;
    }
    const next: TranscriptMap = { ...current };
    delete next[id];
    try {
      await backend.write(JSON.stringify(next));
    } catch {
      // A blocked storage must never break the chat.
    }
  });
}
