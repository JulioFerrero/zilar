import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { VOICE_MIN_MS, VoiceError, VoiceRecorder } from '@/lib/voice';
import { renderApp } from '@/test/renderApp';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function stubStart() {
  let resolveStart!: (recorder: VoiceRecorder) => void;
  let rejectStart!: (error: unknown) => void;
  const pending = new Promise<VoiceRecorder>((resolve, reject) => {
    resolveStart = resolve;
    rejectStart = reject;
  });
  const startSpy = vi.spyOn(VoiceRecorder, 'start').mockReturnValue(pending);
  const makeRecorder = (overrides?: { stop?: () => Promise<unknown>; cancel?: () => void }) =>
    ({
      durationMs: VOICE_MIN_MS + 1000,
      stop: async () => ({
        blob: new Blob(['bytes'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        durationMs: VOICE_MIN_MS + 1000,
      }),
      cancel: () => {},
      ...overrides,
    }) as unknown as VoiceRecorder;
  // The component awaits `start()` in a void promise: resolving then
  // flushing lets its continuation run inside `act`. A macrotask wait
  // covers the extra microtask hops of the async/await chain.
  const flushStart = async (): Promise<void> => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  return { startSpy, resolveStart, rejectStart, makeRecorder, flushStart };
}

function pressMic(clientX = 100): void {
  fireEvent.pointerDown(screen.getByLabelText('Record voice message'), {
    pointerId: 1,
    clientX,
  });
}

function releaseOnDocument(): void {
  // With pointer capture the release retargets to the mic button, which the
  // recording row has replaced; without capture it bubbles to the document.
  // Either way the component finishes the press from the document level.
  fireEvent.pointerUp(document.body);
}

function holdMic(clientX = 100): void {
  fireEvent.pointerDown(screen.getByLabelText('Record voice message'), {
    pointerId: 1,
    clientX,
  });
}

function releaseMic(): void {
  releaseOnDocument();
}

describe('Composer voice recording (T-0166)', () => {
  it('clicks to record and sends through the Send button', async () => {
    const { startSpy, resolveStart, makeRecorder, flushStart } = stubStart();
    const recorder = makeRecorder();
    const cancelSpy = vi.spyOn(recorder, 'cancel');
    const { store } = renderApp('/c/c-ana');
    const before = store.getState().messages('c-ana').length;

    pressMic();
    expect(startSpy).toHaveBeenCalledTimes(1);
    resolveStart(recorder);
    await flushStart();
    // The recording row shows the elapsed time and the cancel gesture.
    expect(screen.getByText('Slide to cancel')).toBeTruthy();

    // A short release locks into click mode with Send/Cancel to finish.
    releaseMic();
    expect(screen.getByLabelText('Send voice message')).toBeTruthy();
    expect(screen.getByLabelText('Cancel voice message')).toBeTruthy();
    expect(cancelSpy).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Send voice message'));
    });
    expect(store.getState().messages('c-ana')).toHaveLength(before + 1);
  });

  it('keeps recording when permission is granted after release (click mode)', async () => {
    const { resolveStart, makeRecorder, flushStart } = stubStart();
    const recorder = makeRecorder();
    const cancelSpy = vi.spyOn(recorder, 'cancel');
    renderApp('/c/c-ana');

    // The pointer is released while the browser's permission prompt is up:
    // press down, then click (release) before `start()` resolves.
    holdMic();
    releaseMic();
    resolveStart(recorder);
    await flushStart();

    // Never silently cancelled: still recording, with Send/Cancel to finish.
    expect(screen.getByLabelText('Send voice message')).toBeTruthy();
    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it('shows the blocked message when permission is denied', async () => {
    const { rejectStart, flushStart } = stubStart();
    renderApp('/c/c-ana');

    pressMic();
    rejectStart(
      new VoiceError(
        'voice_blocked',
        "Microphone access is blocked. Allow it in the browser's site settings.",
      ),
    );
    await flushStart();

    expect(await screen.findByText(/Microphone access is blocked/)).toBeTruthy();
  });

  it('sends on release after a long hold', async () => {
    const { resolveStart, makeRecorder, flushStart } = stubStart();
    const { store } = renderApp('/c/c-ana');

    holdMic();
    const recorder = makeRecorder();
    resolveStart(recorder);
    await flushStart();
    expect(screen.getByText('Slide to cancel')).toBeTruthy();
    // A real 500 ms wait crosses the 400 ms hold threshold.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    const before = store.getState().messages('c-ana').length;
    await act(async () => {
      releaseMic();
    });
    expect(store.getState().messages('c-ana')).toHaveLength(before + 1);
  });

  it('cancels with the trash button and sends nothing', async () => {
    const { resolveStart, makeRecorder, flushStart } = stubStart();
    const recorder = makeRecorder();
    const cancelSpy = vi.spyOn(recorder, 'cancel');
    const { store } = renderApp('/c/c-ana');
    const before = store.getState().messages('c-ana').length;

    pressMic();
    resolveStart(recorder);
    await flushStart();
    releaseMic();
    expect(screen.getByLabelText('Send voice message')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Cancel voice message'));

    expect(cancelSpy).toHaveBeenCalled();
    expect(store.getState().messages('c-ana')).toHaveLength(before);
    expect(screen.queryByLabelText('Send voice message')).toBeNull();
  });

  it('cancels with Escape and sends nothing', async () => {
    const { resolveStart, makeRecorder, flushStart } = stubStart();
    const recorder = makeRecorder();
    const cancelSpy = vi.spyOn(recorder, 'cancel');
    const { store } = renderApp('/c/c-ana');
    const before = store.getState().messages('c-ana').length;

    pressMic();
    resolveStart(recorder);
    await flushStart();
    releaseMic();
    expect(screen.getByLabelText('Send voice message')).toBeTruthy();
    // Escape is handled on the document while recording in click mode.
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(cancelSpy).toHaveBeenCalled();
    expect(store.getState().messages('c-ana')).toHaveLength(before);
  });

  it('stops the microphone when the chat switches mid-recording', async () => {
    const { resolveStart, makeRecorder, flushStart } = stubStart();
    const recorder = makeRecorder();
    const cancelSpy = vi.spyOn(recorder, 'cancel');
    renderApp('/c/c-ana');

    pressMic();
    resolveStart(recorder);
    await flushStart();
    expect(screen.getByText('Slide to cancel')).toBeTruthy();

    // Leaving the chat discards the recording and stops the mic tracks:
    // navigate to another chat like a user would.
    fireEvent.click(screen.getByText('Viernes 🍻'));
    await flushStart();

    expect(cancelSpy).toHaveBeenCalled();
    expect(screen.queryByText('Slide to cancel')).toBeNull();
  });

  it('shows "Recording too short" for an accidental tap', async () => {
    const { resolveStart, makeRecorder, flushStart } = stubStart();
    const recorder = makeRecorder({
      stop: async () => ({
        blob: new Blob(['bytes'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        durationMs: VOICE_MIN_MS - 100,
      }),
    });
    const { store } = renderApp('/c/c-ana');
    const before = store.getState().messages('c-ana').length;

    holdMic();
    resolveStart(recorder);
    await flushStart();
    // A long hold released after start sends (or, here, reports too short).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    await act(async () => {
      releaseMic();
    });

    expect(await screen.findByText('Recording too short')).toBeTruthy();
    expect(store.getState().messages('c-ana')).toHaveLength(before);
  });
});
