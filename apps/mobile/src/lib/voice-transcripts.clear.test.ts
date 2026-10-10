import { describe, expect, it } from 'vitest';

import {
  clearTranscripts,
  readTranscripts,
  saveTranscript,
  type TranscriptFile,
} from './voice-transcripts';

function memoryFile(): TranscriptFile {
  let raw: string | null = null;
  return {
    read: async () => raw,
    write: async (next: string) => {
      raw = next;
    },
  };
}

describe('clearTranscripts (T-0901)', () => {
  it('forgets every stored transcript', async () => {
    const file = memoryFile();
    await saveTranscript('m-1', { text: 'private note' }, file);
    await saveTranscript('m-2', { text: 'another one', language: 'en' }, file);

    await clearTranscripts(file);

    expect(await readTranscripts(file)).toEqual({});
  });

  it('resolves when the storage refuses the write', async () => {
    const file: TranscriptFile = {
      read: async () => null,
      write: async () => {
        throw new Error('blocked');
      },
    };

    await expect(clearTranscripts(file)).resolves.toBeUndefined();
  });
});
