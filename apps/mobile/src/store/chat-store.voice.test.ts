import { describe, expect, it } from 'vitest';

import { createChatStore } from './chat-store';
import type { SendVoiceRecording } from './types';

const RECORDING: SendVoiceRecording = {
  uri: 'file:///cache/rec.m4a',
  mimeType: 'audio/mp4',
  size: 120_000,
  durationMs: 4321,
  waveform: [10, 20, 30],
};

describe('mock store sends voice messages (T-0154)', () => {
  it('sends a voice optimistically with the voice payload shape', () => {
    const store = createChatStore();
    store.getState().sendVoice('ana', RECORDING);

    const sent = store.getState().messages('ana').at(-1);
    expect(sent?.voice).toEqual({
      duration_ms: 4321,
      mime: 'audio/mp4',
      waveform: [10, 20, 30],
      url: 'file:///cache/rec.m4a',
    });
    expect(sent?.status).toBe('sending');
  });

  it('retries a failed voice by resending it', () => {
    const store = createChatStore();
    store.getState().sendVoice('ana', RECORDING);
    const id = store.getState().messages('ana').at(-1)?.id ?? '';
    store.getState().retryVoice('ana', id);
    expect(
      store
        .getState()
        .messages('ana')
        .find((item) => item.id === id)?.status,
    ).toBe('sending');
  });

  it('cancels a sending voice by removing the bubble', () => {
    const store = createChatStore();
    store.getState().sendVoice('ana', RECORDING);
    const id = store.getState().messages('ana').at(-1)?.id ?? '';
    store.getState().cancelVoice('ana', id);
    expect(
      store
        .getState()
        .messages('ana')
        .find((item) => item.id === id),
    ).toBeUndefined();
  });

  it('ignores unknown chats', () => {
    const store = createChatStore();
    const before = store.getState().messages('ana').length;
    store.getState().sendVoice('nope', RECORDING);
    expect(store.getState().messages('ana')).toHaveLength(before);
  });
});
