import { describe, expect, it, vi } from 'vitest';

import { createWhistlePort } from './whistle-port';
import { lastVoiceNoteOf } from './whistle-last-note';
import type { UiMessage } from '@zilar/chat-core';

function message(overrides: Partial<UiMessage> & { id: string; chatId: string }): UiMessage {
  return {
    senderId: 'me',
    senderName: 'You',
    createdAt: new Date('2026-10-03T10:00:00Z'),
    status: 'sent',
    ...overrides,
  };
}

describe('whistle port (T-0177)', () => {
  it('drives the status flow through the injected module', async () => {
    const port = createWhistlePort({
      isAvailable: () => true,
      modelStatus: async () => 'ready',
      downloadModel: async () => {},
      loadModel: async () => {},
      transcribe: async () => ({
        text: 'hello',
        language: 'en',
        ttftMs: 5,
        decodeTps: 30,
        audioMs: 2000,
        wallMs: 900,
      }),
    });
    expect(port.isAvailable()).toBe(true);
    expect(await port.modelStatus()).toBe('ready');
    const result = await port.transcribe('file:///a.m4a');
    expect(result.text).toBe('hello');
    expect(result.wallMs).toBe(900);
  });

  it('reports progress while downloading', async () => {
    const seen: number[] = [];
    const port = createWhistlePort({
      downloadModel: async (onProgress) => {
        onProgress?.(0.5);
        onProgress?.(1);
      },
    });
    await port.downloadModel((fraction) => {
      seen.push(fraction);
    });
    expect(seen).toEqual([0.5, 1]);
  });

  it('a throwing availability check is unavailable, never a crash', () => {
    const port = createWhistlePort({
      isAvailable: () => {
        throw new Error('no native module');
      },
    });
    expect(port.isAvailable()).toBe(false);
  });

  it('an unimplemented port rejects transcriptions as unavailable', async () => {
    const port = createWhistlePort({});
    await expect(port.transcribe('file:///a.m4a')).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('the production port reads the real native check, false with none linked', () => {
    const port = createWhistlePort();
    // Under Vitest no native module is linked: the require throws and the
    // port reports unavailable instead of crashing.
    expect(port.isAvailable()).toBe(false);
    expect(vi.isMockFunction(port.modelStatus)).toBe(false);
  });

  it('the production port reports true when the native check passes', () => {
    const port = createWhistlePort({
      isAvailable: () => true,
    });
    expect(port.isAvailable()).toBe(true);
  });
});

describe('last voice note (T-0177)', () => {
  it('returns the newest voice message with a playable URI', () => {
    const byChat = {
      'chat-1': [
        message({
          id: 'm-1',
          chatId: 'chat-1',
          voice: { duration_ms: 3000, mime: 'audio/mp4', waveform: [1] },
        }),
        message({
          id: 'm-2',
          chatId: 'chat-1',
          createdAt: new Date('2026-10-03T11:00:00Z'),
          voice: {
            duration_ms: 5000,
            mime: 'audio/mp4',
            waveform: [1],
            url: 'https://x/voice.m4a',
          },
        }),
      ],
    };
    expect(lastVoiceNoteOf(byChat)).toEqual({
      messageId: 'm-2',
      chatId: 'chat-1',
      uri: 'https://x/voice.m4a',
      durationMs: 5000,
    });
  });

  it('prefers the local file while it uploads and skips deleted notes', () => {
    const byChat = {
      'chat-1': [
        message({
          id: 'm-9',
          chatId: 'chat-1',
          createdAt: new Date('2026-10-03T12:00:00Z'),
          deleted: true,
          voice: { duration_ms: 1000, mime: 'audio/mp4', waveform: [1], url: 'https://x/old.m4a' },
        }),
        message({
          id: 'm-3',
          chatId: 'chat-1',
          createdAt: new Date('2026-10-03T11:30:00Z'),
          voice: { duration_ms: 4000, mime: 'audio/mp4', waveform: [1], url: 'https://x/a.m4a' },
          localUri: 'file:///cache/rec.m4a',
        } as unknown as Partial<UiMessage> & { id: string; chatId: string }),
      ],
    };
    expect(lastVoiceNoteOf(byChat)?.uri).toBe('file:///cache/rec.m4a');
  });

  it('returns undefined when no chat holds a playable voice', () => {
    expect(
      lastVoiceNoteOf({
        'chat-1': [message({ id: 'm-1', chatId: 'chat-1', text: 'hi' })],
        'chat-2': [
          message({
            id: 'm-2',
            chatId: 'chat-2',
            voice: { duration_ms: 1000, mime: 'audio/mp4', waveform: [1] },
          }),
        ],
      }),
    ).toBeUndefined();
    expect(lastVoiceNoteOf({})).toBeUndefined();
  });
});
