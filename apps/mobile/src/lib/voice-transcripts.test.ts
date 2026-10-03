import { describe, expect, it } from 'vitest';

import {
  deleteTranscript,
  MAX_STORED_TRANSCRIPTS,
  parseTranscripts,
  readTranscripts,
  saveTranscript,
  type TranscriptFile,
} from './voice-transcripts';

function memoryFile(initial: string | null = null): TranscriptFile & { writes: string[] } {
  let raw = initial;
  const backend: TranscriptFile & { writes: string[] } = {
    writes: [],
    read: async () => raw,
    write: async (next: string) => {
      backend.writes.push(next);
      raw = next;
    },
  };
  return backend;
}

describe('voice transcripts store (T-0179)', () => {
  it('round-trips one transcript', async () => {
    const file = memoryFile();
    await saveTranscript('m-1', { text: 'hello there', language: 'en' }, file);
    expect(await readTranscripts(file)).toEqual({ 'm-1': { text: 'hello there', language: 'en' } });
  });

  it('a missing or hostile file reads as empty', async () => {
    expect(await readTranscripts(memoryFile(null))).toEqual({});
    expect(await readTranscripts(memoryFile(''))).toEqual({});
    expect(await readTranscripts(memoryFile('not json'))).toEqual({});
    expect(await readTranscripts(memoryFile('{"m-1": {"text": 3}}'))).toEqual({});
    expect(await readTranscripts(memoryFile('[]'))).toEqual({});
    expect(parseTranscripts('{"m-1": {"text": ""}}')).toEqual({});
  });

  it('a hostile file does not block the next save', async () => {
    const file = memoryFile('not json');
    await saveTranscript('m-1', { text: 'hello' }, file);
    expect(await readTranscripts(file)).toEqual({ 'm-1': { text: 'hello' } });
  });

  it('keeps at most 500 transcripts, oldest dropped', async () => {
    const file = memoryFile();
    for (let index = 0; index < MAX_STORED_TRANSCRIPTS + 5; index += 1) {
      await saveTranscript(`m-${index}`, { text: `note ${index}` }, file);
    }
    const stored = await readTranscripts(file);
    expect(Object.keys(stored)).toHaveLength(MAX_STORED_TRANSCRIPTS);
    expect(stored['m-0']).toBeUndefined();
    expect(stored['m-4']).toBeUndefined();
    expect(stored[`m-${MAX_STORED_TRANSCRIPTS + 4}`]).toEqual({
      text: `note ${MAX_STORED_TRANSCRIPTS + 4}`,
    });
  });

  it('re-saving moves the entry newest without growing the file', async () => {
    const file = memoryFile();
    for (let index = 0; index < MAX_STORED_TRANSCRIPTS; index += 1) {
      await saveTranscript(`m-${index}`, { text: `note ${index}` }, file);
    }
    await saveTranscript('m-0', { text: 'updated' }, file);
    const stored = await readTranscripts(file);
    expect(Object.keys(stored)).toHaveLength(MAX_STORED_TRANSCRIPTS);
    expect(stored['m-0']).toEqual({ text: 'updated' });
    await saveTranscript('m-new', { text: 'newest' }, file);
    const after = await readTranscripts(file);
    expect(Object.keys(after)).toHaveLength(MAX_STORED_TRANSCRIPTS);
    expect(after['m-1']).toBeUndefined();
    expect(after['m-0']).toEqual({ text: 'updated' });
  });

  it('caps one transcript at 20 000 chars', async () => {
    const file = memoryFile();
    await saveTranscript('m-1', { text: 'a'.repeat(25_000) }, file);
    const stored = await readTranscripts(file);
    expect(stored['m-1']?.text).toHaveLength(20_000);
  });

  it('deletes one transcript and keeps the rest', async () => {
    const file = memoryFile();
    await saveTranscript('m-1', { text: 'one' }, file);
    await saveTranscript('m-2', { text: 'two' }, file);
    await deleteTranscript('m-1', file);
    expect(await readTranscripts(file)).toEqual({ 'm-2': { text: 'two' } });
  });

  it('a failing storage never throws', async () => {
    const failing: TranscriptFile = {
      read: async () => {
        throw new Error('no storage in tests');
      },
      write: async () => {
        throw new Error('no storage in tests');
      },
    };
    await expect(readTranscripts(failing)).resolves.toEqual({});
    await expect(saveTranscript('m-1', { text: 'hi' }, failing)).resolves.toBeUndefined();
    await expect(deleteTranscript('m-1', failing)).resolves.toBeUndefined();
  });

  it('an empty id or empty text stores nothing', async () => {
    const file = memoryFile();
    await saveTranscript('', { text: 'hi' }, file);
    await saveTranscript('m-1', { text: '' }, file);
    expect(await readTranscripts(file)).toEqual({});
    expect(file.writes).toEqual([]);
  });
});
