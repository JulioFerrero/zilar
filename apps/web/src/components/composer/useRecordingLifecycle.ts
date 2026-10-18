import { Effect, Schedule } from 'effect';
import { useEffect } from 'react';
import { stopTimer, type VoiceRecorderController } from './composerShared';

export function useRecordingLifecycle({
  chatId,
  voice,
}: {
  chatId: string;
  voice: VoiceRecorderController;
}): void {
  const {
    pressRef,
    recorderRef,
    recordingRef,
    setRecording,
    setLocked,
    setCancelArmed,
    setElapsedMs,
    setVoiceError,
    recording,
    cancelRecording,
    finishRecording,
    onMicPointerMove,
  } = voice;

  useEffect(
    () => () => {
      if (pressRef.current?.holdTimer !== undefined) {
        stopTimer(pressRef.current.holdTimer);
      }
      pressRef.current = null;
      const recorder = recorderRef.current;
      recorderRef.current = null;
      recordingRef.current = false;
      recorder?.cancel();
    },
    [pressRef, recorderRef, recordingRef],
  );

  // Switching chats while recording stops the microphone tracks (the browser's
  // recording indicator must go off) and discards the recording. A leftover
  // error belongs to the previous chat, so it is cleared too.
  useEffect(() => {
    if (!recordingRef.current && pressRef.current?.holdTimer === undefined) {
      return;
    }
    if (pressRef.current?.holdTimer !== undefined) {
      stopTimer(pressRef.current.holdTimer);
    }
    pressRef.current = null;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    recordingRef.current = false;
    recorder?.cancel();
    setRecording(false);
    setLocked(false);
    setCancelArmed(false);
    setVoiceError(undefined);
  }, [
    chatId,
    pressRef,
    recorderRef,
    recordingRef,
    setRecording,
    setLocked,
    setCancelArmed,
    setVoiceError,
  ]);

  useEffect(() => {
    if (!recording) {
      return;
    }
    // The first tick comes after 100 ms, then every 100 ms, as `setInterval` did.
    const tick = Effect.sync(() => {
      const recorder = recorderRef.current;
      if (recorder !== null) {
        setElapsedMs(recorder.durationMs);
      }
    });
    const timer = Effect.runFork(
      Effect.repeat(tick, Schedule.spaced(100)).pipe(Effect.delay(100), Effect.asVoid),
    );
    return () => stopTimer(timer);
  }, [recording, recorderRef, setElapsedMs]);

  // Escape is a backstop while recording (click mode or a held press): a
  // document listener, since the mic button holds pointer capture and the
  // textarea is hidden while the recording row shows.
  useEffect(() => {
    if (!recording) {
      return;
    }
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancelRecording();
      }
    };
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => document.removeEventListener('keydown', onDocumentKeyDown);
  }, [recording, cancelRecording]);

  const onMicPointerUp = (): void => {
    const press = pressRef.current;
    if (press === null) {
      if (recorderRef.current !== null) {
        finishRecording(false);
      }
      return;
    }
    if (press.holdTimer !== undefined) {
      stopTimer(press.holdTimer);
      press.holdTimer = undefined;
    }
    press.released = true;
    if (recorderRef.current === null) {
      return;
    }
    if (press.hold && !press.slidToCancel) {
      finishRecording(false);
      return;
    }
    if (press.slidToCancel) {
      finishRecording(true);
      return;
    }
    pressRef.current = null;
    setLocked(true);
  };

  // The pointer-up may land anywhere: with pointer capture the browser
  // retargets it to the mic button (since replaced by the recording row);
  // without capture it lands on the element under the pointer. A document
  // listener finishes the press wherever it lands.
  useEffect(() => {
    const onDocumentPointerUp = (): void => {
      if (pressRef.current !== null) {
        onMicPointerUp();
      }
    };
    const onDocumentPointerMove = (event: globalThis.PointerEvent): void => {
      onMicPointerMove(event.clientX);
    };
    document.addEventListener('pointerup', onDocumentPointerUp);
    document.addEventListener('pointermove', onDocumentPointerMove);
    return () => {
      document.removeEventListener('pointerup', onDocumentPointerUp);
      document.removeEventListener('pointermove', onDocumentPointerMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
