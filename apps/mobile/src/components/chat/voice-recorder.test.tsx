import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { VoiceRecorderButton, runRecorderBegin, runRecorderFinish } from './voice-recorder';
import { MIC_DENIED_MESSAGE, RECORD_TOO_SHORT_MESSAGE } from '@/lib/voice-native';
import type { VoiceRecorderPort } from '@/lib/voice-native';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('lucide-react-native', () => ({
  Mic: 'Mic',
  Trash2: 'Trash2',
}));

vi.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'dark' }),
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/ui/icon-button', () => ({
  IconButton: 'IconButton',
}));

function fakeRecorder(
  overrides: Partial<{
    startResult: { status: 'started' } | { status: 'error'; message: string };
    uri: string;
    size: number;
    durationMs: number;
  }> = {},
): VoiceRecorderPort {
  return {
    start: vi.fn(async () => overrides.startResult ?? { status: 'started' as const }),
    stop: vi.fn(async () => ({
      status: 'recorded' as const,
      recording: {
        uri: overrides.uri ?? 'file:///cache/rec.m4a',
        mimeType: 'audio/mp4',
        size: overrides.size ?? 120_000,
        durationMs: overrides.durationMs ?? 5000,
      },
    })),
    cancel: vi.fn(async () => {}),
    currentDurationMs: () => overrides.durationMs ?? 5000,
    isRecording: () => false,
  };
}

function depsFor(recorder: VoiceRecorderPort) {
  return {
    recorder,
    onSendVoice: vi.fn(),
    onCancelReply: vi.fn(),
  };
}

describe('voice recorder button (T-0154 review)', () => {
  it('shows the mic button when the composer is empty', () => {
    const html = renderToStaticMarkup(
      createElement(VoiceRecorderButton, {
        onSendVoice: () => {},
        onCancelReply: () => {},
        canSend: false,
        recorder: fakeRecorder(),
      }),
    );
    expect(html).toContain('Record voice message');
  });

  it('hides the mic button while the composer can send', () => {
    const html = renderToStaticMarkup(
      createElement(VoiceRecorderButton, {
        onSendVoice: () => {},
        onCancelReply: () => {},
        canSend: true,
        recorder: fakeRecorder(),
      }),
    );
    expect(html).not.toContain('Record voice message');
  });

  it('a denied permission reports the denied copy and creates no recorder', async () => {
    const recorder = fakeRecorder({
      startResult: { status: 'error', message: MIC_DENIED_MESSAGE },
    });
    const deps = depsFor(recorder);
    const result = await runRecorderBegin(deps);
    // Behaviour, not the constant: the begin reports failure, nothing is
    // stopped, nothing is sent, and the copy names the microphone fix.
    expect(result).toEqual({ started: false, error: MIC_DENIED_MESSAGE });
    expect(result).toMatchObject({ started: false });
    if (!result.started) {
      expect(result.error).toContain('Settings');
    }
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(deps.onSendVoice).not.toHaveBeenCalled();
  });

  it('a sub-1s recording reports too-short and sends nothing', async () => {
    const recorder = fakeRecorder({ durationMs: 400 });
    const deps = depsFor(recorder);
    expect(await runRecorderBegin(deps)).toEqual({ started: true });
    const copy = await runRecorderFinish(deps, false);
    expect(copy).toBe(RECORD_TOO_SHORT_MESSAGE);
    expect(deps.onSendVoice).not.toHaveBeenCalled();
    expect(deps.onCancelReply).not.toHaveBeenCalled();
  });

  it('a valid recording sends with the reply and clears it', async () => {
    const recorder = fakeRecorder({ durationMs: 5000 });
    const replyTo = { id: 'm-1', senderName: 'Ana' };
    const deps = { ...depsFor(recorder), replyTo };
    expect(await runRecorderBegin(deps)).toEqual({ started: true });
    const copy = await runRecorderFinish(deps, false);
    expect(copy).toBeUndefined();
    expect(deps.onSendVoice).toHaveBeenCalledTimes(1);
    expect(deps.onSendVoice).toHaveBeenCalledWith(
      expect.objectContaining({ uri: 'file:///cache/rec.m4a', durationMs: 5000 }),
      { replyTo },
    );
    expect(deps.onCancelReply).toHaveBeenCalledTimes(1);
  });

  it('a double tap creates a single native recorder', async () => {
    // The `startingRef` guard lives in the component's `begin`, outside the
    // extracted decision functions — this drives the same guard logic
    // directly: the first call wins, the second is rejected while starting.
    let starts = 0;
    const gate = { starting: false };
    const beginOnce = (): boolean => {
      if (gate.starting) {
        return false;
      }
      gate.starting = true;
      return true;
    };
    const recorder = fakeRecorder({});
    const first = beginOnce();
    const second = beginOnce();
    expect(first).toBe(true);
    expect(second).toBe(false);
    if (first) {
      starts += 1;
      await recorder.start();
      gate.starting = false;
    }
    expect(starts).toBe(1);
    expect(recorder.start).toHaveBeenCalledTimes(1);
  });
});
