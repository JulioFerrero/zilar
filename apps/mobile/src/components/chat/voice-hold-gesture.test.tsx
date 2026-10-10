// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { VoiceRecorderPort } from '@/lib/voice-native';
import { settle } from '@/test/wait';
import { VoiceRecorderButton } from './voice-recorder';

// Hold to record, release to send, slide left to cancel. The mic must stay
// mounted under the finger (a remount drops the touch), and there is no
// separate Send button. The button is mounted for real; the pan responder is
// captured so the test drives the same grant, move and release events a touch
// would.
const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

type Gesture = { dx: number };
type PanConfig = {
  onPanResponderGrant: () => void;
  onPanResponderRelease: (event: unknown, gesture: Gesture) => void;
};

const captured: { pan?: PanConfig } = {};

vi.mock('react-native', () => ({
  PanResponder: {
    create: (config: PanConfig) => {
      captured.pan = config;
      return { panHandlers: {} };
    },
  },
  Pressable: ({ children }: { children?: ReactNode }) => createElement('button', null, children),
  View: ({ children, accessibilityLabel }: { children?: ReactNode; accessibilityLabel?: string }) =>
    createElement('div', { 'aria-label': accessibilityLabel }, children),
}));

vi.mock('@/lib/depth', () => ({ ACCENT_FOREGROUND: '#0a0a0a', primaryKey: {} }));
vi.mock('lucide-react-native', () => ({ Mic: () => null, Trash2: () => null }));
vi.mock('@/components/ui/text', () => ({
  Text: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
}));

const MIC = 'Hold to record voice message';

function fakeRecorder(): VoiceRecorderPort {
  return {
    start: vi.fn(async () => ({ status: 'started' as const })),
    stop: vi.fn(async () => ({
      status: 'recorded' as const,
      recording: {
        uri: 'file:///cache/rec.m4a',
        mimeType: 'audio/mp4',
        size: 120_000,
        durationMs: 5000,
      },
    })),
    cancel: vi.fn(async () => {}),
    currentDurationMs: () => 5000,
    currentLevel: () => 0,
    isRecording: () => false,
  };
}

const mounted: Array<() => void> = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  captured.pan = undefined;
  while (mounted.length > 0) {
    mounted.pop()?.();
  }
});

async function mountButton() {
  const recorder = fakeRecorder();
  const onSendVoice = vi.fn();
  const onRecordingChange = vi.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(VoiceRecorderButton, {
        onSendVoice,
        onCancelReply: () => {},
        canSend: false,
        recorder,
        onRecordingChange,
      }),
    );
  });
  mounted.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  await settle();
  return { container, recorder, onSendVoice, onRecordingChange };
}

function pan(): PanConfig {
  if (captured.pan === undefined) {
    throw new Error('The mic has no pan responder yet');
  }
  return captured.pan;
}

describe('voice recorder hold gesture', () => {
  it('keeps the same mic under the finger while recording and sends on release', async () => {
    const { container, onSendVoice, onRecordingChange } = await mountButton();
    const micBefore = container.querySelector(`[aria-label="${MIC}"]`);
    expect(micBefore).not.toBeNull();

    act(() => pan().onPanResponderGrant());
    await settle();
    expect(onRecordingChange).toHaveBeenLastCalledWith(true);
    expect(container.textContent).toContain('Slide to cancel');
    expect(container.querySelector(`[aria-label="${MIC}"]`)).toBe(micBefore);
    expect(container.querySelector('[aria-label="Send voice message"]')).toBeNull();
    expect(onSendVoice).not.toHaveBeenCalled();

    act(() => pan().onPanResponderRelease({}, { dx: -10 }));
    await settle();
    expect(onSendVoice).toHaveBeenCalledTimes(1);
    expect(onRecordingChange).toHaveBeenLastCalledWith(false);
  });

  it('cancels instead of sending when the finger slid far enough to the left', async () => {
    const { recorder, onSendVoice } = await mountButton();
    act(() => pan().onPanResponderGrant());
    await settle();
    act(() => pan().onPanResponderRelease({}, { dx: -120 }));
    await settle();
    expect(recorder.cancel).toHaveBeenCalledTimes(1);
    expect(onSendVoice).not.toHaveBeenCalled();
  });
});
