/**
 * The UI-side record of who is playing (T-0154, moved unchanged from
 * `voice-player.ts` by the T-1032 size split): the shared player handle, the
 * per-bubble listeners, the speaker stubs the registry claims and resigns,
 * the progress/error subscriptions, and the routing of real player status
 * ticks to the owning bubble. `voice-player-host.ts` drives it; the barrel
 * `voice-player.ts` re-exports the public surface.
 */

import { Effect } from 'effect';

import type { VoicePlayback, VoiceSpeed } from '@/lib/voice-native';
import { VOICE_SPEEDS } from '@/lib/voice-native';
import type {
  HostPlayer,
  NativePlayer,
  PlayerStatusTick,
} from '@/components/chat/voice-player-host';

let sharedPlayer: NativePlayer | undefined;
let activeMessageId: string | undefined;
export const livePlaybacks = new Set<VoicePlayback>();
export const playerPlaybacks = new Map<NativePlayer, VoicePlayback>();
export const listeners = new Map<
  string,
  (update: { playing: boolean; rate: VoiceSpeed }) => void
>();
export const injectedStatus = new Map<NativePlayer, (status: PlayerStatusTick) => void>();
const progressListeners = new Map<
  string,
  (update: { positionMs: number; durationMs: number }) => void
>();

/** Reads the shared player, so the host can drive it without owning it. */
export function getSharedPlayer(): NativePlayer | undefined {
  return sharedPlayer;
}

/** Sets the shared player; the host calls this when it swaps the source. */
export function setSharedPlayer(player: NativePlayer | undefined): void {
  sharedPlayer = player;
}

/** Reads the active message id the registry records. */
export function getActiveMessageId(): string | undefined {
  return activeMessageId;
}

/** Records the active message id; the host calls this on play/pause. */
export function setActiveMessageId(messageId: string | undefined): void {
  activeMessageId = messageId;
}

/** Releasing never throws to the screen. */
export function releasePlayer(): Effect.Effect<void> {
  return Effect.suspend(() => {
    const player = sharedPlayer;
    sharedPlayer = undefined;
    activeMessageId = undefined;
    return Effect.try(() => player?.remove()).pipe(Effect.ignore);
  });
}

/** Runs one native call that may throw; a failure is dropped. */
export function attempt(call: () => unknown): void {
  Effect.runSync(Effect.try(call).pipe(Effect.ignore));
}

/** Starts one native call that returns a Promise; a failure is dropped. */
export function attemptAsync(call: () => PromiseLike<unknown>): void {
  Effect.runFork(Effect.tryPromise(call).pipe(Effect.ignore));
}

const resolved = (): Promise<void> => Effect.runPromise(Effect.void);

export function currentRate(player: NativePlayer): VoiceSpeed {
  const rate = (player as { playbackRate?: number }).playbackRate ?? 1;
  return (VOICE_SPEEDS as readonly number[]).includes(rate) ? (rate as VoiceSpeed) : 1;
}

/** A bubble reports its play progress through the host (drives the bar). */
export function subscribeVoiceProgress(
  messageId: string,
  listener: (update: { positionMs: number; durationMs: number }) => void,
): () => void {
  progressListeners.set(messageId, listener);
  return () => {
    if (progressListeners.get(messageId) === listener) {
      progressListeners.delete(messageId);
    }
  };
}

/** A play failure surfaces on the bubble that asked (finding 8). */
const playErrorListeners = new Map<string, (message: string) => void>();

export function subscribeVoicePlayError(
  messageId: string,
  listener: (message: string) => void,
): () => void {
  playErrorListeners.set(messageId, listener);
  return () => {
    if (playErrorListeners.get(messageId) === listener) {
      playErrorListeners.delete(messageId);
    }
  };
}

export function notifyPlayError(messageId: string, message: string): void {
  playErrorListeners.get(messageId)?.(message);
}

export function activeSpeaker(messageId: string, rate: VoiceSpeed) {
  return {
    messageId,
    playing: true,
    positionMs: 0,
    durationMs: 0,
    speed: rate,
    play: () => {},
    pause: () => {
      // The registry only records UI state: pausing the shared player here
      // would also stop the bubble that just claimed it (finding 1).
    },
    seekTo: resolved,
    cycleSpeed: () => {},
    release: () => {},
  };
}

export function resignedSpeaker(messageId: string) {
  return {
    messageId,
    playing: false,
    positionMs: 0,
    durationMs: 0,
    speed: 1 as VoiceSpeed,
    play: () => {},
    pause: () => {},
    seekTo: resolved,
    cycleSpeed: () => {},
    release: () => {},
  };
}

function playbackFor(player: NativePlayer): VoicePlayback | undefined {
  return playerPlaybacks.get(player);
}

/** Routes one real-player status tick to the owning bubble (and the bar). */
export function onPlayerStatus(
  messageId: string,
  player: NativePlayer,
  status: PlayerStatusTick,
): void {
  // A stale tick from a replaced player must not move another bubble.
  if (sharedPlayer !== player || activeMessageId !== messageId) {
    return;
  }
  if (status.error !== null && status.error !== '') {
    activeMessageId = undefined;
    playbackFor(player)?.resign(resignedSpeaker(messageId));
    listeners.get(messageId)?.({ playing: false, rate: 1 });
    notifyPlayError(messageId, 'Could not play that voice message.');
    return;
  }
  if (status.didJustFinish) {
    activeMessageId = undefined;
    playbackFor(player)?.resign(resignedSpeaker(messageId));
    listeners.get(messageId)?.({ playing: false, rate: 1 });
    progressListeners.get(messageId)?.({
      positionMs: 0,
      durationMs: Math.max(0, Math.round(status.duration * 1000)),
    });
    return;
  }
  progressListeners.get(messageId)?.({
    positionMs: Math.max(0, Math.round(status.currentTime * 1000)),
    durationMs: Math.max(0, Math.round(status.duration * 1000)),
  });
}

/** Test seam: drives one injected status tick (finding 1). */
export function emitPlayerStatusForTest(player: HostPlayer, status: PlayerStatusTick): void {
  const emit = (player as { __emitStatus?: (status: PlayerStatusTick) => void }).__emitStatus;
  emit?.(status);
  for (const handler of injectedStatus.values()) {
    handler(status);
  }
}

/** Test seam: reset the module host state between tests. */
export function resetVoicePlayerForTest(): void {
  // Releasing never throws.
  attempt(() => sharedPlayer?.remove());
  sharedPlayer = undefined;
  activeMessageId = undefined;
  injectedStatus.clear();
  listeners.clear();
  progressListeners.clear();
  playErrorListeners.clear();
  for (const playback of livePlaybacks) {
    playback.stopAll();
  }
  livePlaybacks.clear();
  playerPlaybacks.clear();
}

/** A bubble subscribes to its own play state through the host. */
export function subscribeVoiceState(
  messageId: string,
  listener: (update: { playing: boolean; rate: VoiceSpeed }) => void,
): () => void {
  listeners.set(messageId, listener);
  return () => {
    if (listeners.get(messageId) === listener) {
      listeners.delete(messageId);
    }
  };
}
