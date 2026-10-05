/**
 * The screen-owned voice player (T-0154, review round 1): a single
 * `expo-audio` player that every voice bubble shares. The chat screen
 * creates it with `useVoicePlayerHost` and hands `controls` to each
 * `VoiceMessage`; unmounting (leaving the chat) stops playback and releases
 * the native player.
 *
 * One player at a time works like this: `play(B)` on the shared player
 * replaces the source (which stops A's audio natively) and notifies only
 * B's listener, so B shows playing; A's bubble is told to show paused
 * through its own listener — the shared player is never paused as a side
 * effect of switching. The registry (`createVoicePlayback`) is the UI-side
 * record of who is current; the host drives it from the real player events.
 *
 * The player is created lazily with `createAudioPlayer` (not the hook) so
 * the host lives outside any one bubble's lifecycle: a bubble unmounting
 * mid-play must not release the player another bubble is using.
 */

import { useEffect, useState } from 'react';

import type { VoicePlayback, VoiceSpeed } from '@/lib/voice-native';
import { createVoicePlayback, VOICE_SPEEDS } from '@/lib/voice-native';

/** The seekable voice player inside the bubble; the screen owns the registry. */
export interface VoicePlayerControls {
  play(
    messageId: string,
    source: { uri: string; headers?: Record<string, string> },
    resumeMs?: number,
  ): void;
  pause(): void;
  seekTo(positionMs: number): Promise<void>;
  cycleSpeed(): void;
}

export type VoicePlayerHost = {
  playback: VoicePlayback;
  controls: VoicePlayerControls;
};

/** Creates the shared registry + controls; stops playback on unmount. */
export function useVoicePlayerHost(): VoicePlayerHost {
  const [host] = useState<VoicePlayerHost>(() => createVoicePlayerHost());
  useEffect(() => {
    return () => {
      host.playback.stopAll();
      void releasePlayer().catch(() => {});
    };
  }, [host]);
  return host;
}

/**
 * A host whose player is injected (tests inject a fake; production lazily
 * creates the real `expo-audio` player). Every bubble of one chat shares
 * one host, so only one voice plays at a time.
 */
export interface HostPlayer {
  play(): void;
  pause(): void;
  seekTo(seconds: number): Promise<void>;
  replace(source: { uri: string; headers?: Record<string, string> }): void;
  setPlaybackRate(rate: number): void;
  remove(): void;
  /** Real-time status ticks (the 120 ms `updateInterval`); tests drive it. */
  addStatusListener?: ((listener: (status: PlayerStatusTick) => void) => void) | undefined;
  /** Tests fire one status tick through the injected player. */
  __emitStatus?: ((status: PlayerStatusTick) => void) | undefined;
}

export interface PlayerStatusTick {
  playing: boolean;
  didJustFinish: boolean;
  /** Current position in seconds. */
  currentTime: number;
  /** Total duration in seconds, 0 when unknown. */
  duration: number;
  /** Playback error message, or null when healthy. */
  error: string | null;
}

type NativePlayer = {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => Promise<void>;
  replace: (source: { uri: string; headers?: Record<string, string> }) => void;
  setPlaybackRate: (rate: number) => void;
  remove: () => void;
  addListener?: ((event: string, listener: (status: PlayerStatusTick) => void) => void) | undefined;
};

let sharedPlayer: NativePlayer | undefined;
let activeMessageId: string | undefined;
const livePlaybacks = new Set<VoicePlayback>();
const playerPlaybacks = new Map<NativePlayer, VoicePlayback>();
const listeners = new Map<string, (update: { playing: boolean; rate: VoiceSpeed }) => void>();
const injectedStatus = new Map<NativePlayer, (status: PlayerStatusTick) => void>();
const progressListeners = new Map<
  string,
  (update: { positionMs: number; durationMs: number }) => void
>();

async function releasePlayer(): Promise<void> {
  const player = sharedPlayer;
  sharedPlayer = undefined;
  activeMessageId = undefined;
  try {
    player?.remove();
  } catch {
    // Releasing never throws to the screen.
  }
}

function currentRate(player: NativePlayer): VoiceSpeed {
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

function notifyPlayError(messageId: string, message: string): void {
  playErrorListeners.get(messageId)?.(message);
}

function createVoicePlayerHost(createPlayer?: () => HostPlayer): VoicePlayerHost {
  const playback = createVoicePlayback();
  livePlaybacks.add(playback);
  const subscribeStatus = (player: NativePlayer, messageId: string): void => {
    const injected = (player as Partial<HostPlayer>).__emitStatus;
    if (injected !== undefined || player.addListener === undefined) {
      // The injected fake drives ticks through `emitPlayerStatusForTest`
      // (tests); a player without status events still plays.
      injectedStatus.set(player, (status: PlayerStatusTick) =>
        onPlayerStatus(messageId, player, status),
      );
      return;
    }
    const add = player.addListener;
    if (add === undefined) {
      return;
    }
    try {
      add.call(player, 'playbackStatusUpdate', (status: PlayerStatusTick) =>
        onPlayerStatus(messageId, player, status),
      );
    } catch {
      // A player without status events still plays; the bubble keeps its
      // optimistic state and the registry still gates one-at-a-time.
    }
  };
  const controls: VoicePlayerControls = {
    play(messageId, source, resumeMs?: number) {
      // Resuming the paused message on its own live player: continue from
      // the paused position instead of restarting at zero (finding 2,
      // round 3). Pause keeps the instance alive, so `sharedPlayer` is
      // still it — distinguished from a racing fresh instance by the
      // playerPlaybacks record below.
      if (
        sharedPlayer !== undefined &&
        playerPlaybacks.get(sharedPlayer) === playback &&
        resumeMs !== undefined &&
        resumeMs > 0
      ) {
        const player = sharedPlayer;
        void player.seekTo(resumeMs / 1000).catch(() => {});
        activeMessageId = messageId;
        const rate = currentRate(player);
        player.setPlaybackRate(rate);
        player.play();
        playback.claim(activeSpeaker(messageId, rate));
        listeners.get(messageId)?.({ playing: true, rate });
        return;
      }
      const startWith = (player: NativePlayer, atMs?: number): void => {
        // Switching sources stops the previous audio natively: only the new
        // bubble is notified, so it alone shows playing. The previous
        // bubble is told to show paused through its own listener — the
        // shared player is never paused as a side effect of switching.
        // A new native instance always releases the old one and subscribes
        // its own status, even for the same message (finding 2, round 2):
        // two quick plays racing the async import would otherwise leak the
        // first player and leave the bubble's bar dead.
        const previous = activeMessageId;
        if (sharedPlayer !== player) {
          if (sharedPlayer !== undefined) {
            try {
              sharedPlayer.remove();
            } catch {
              // Releasing the previous player never breaks the switch.
            }
            injectedStatus.delete(sharedPlayer);
          }
          sharedPlayer = player;
          playerPlaybacks.set(player, playback);
          subscribeStatus(player, messageId);
        } else if (previous === messageId) {
          // Same player re-handed for the active message (the injected
          // factory returns one instance): still continue from the paused
          // position (finding 2, round 3).
          const atSeconds = Math.max(0, (atMs ?? 0) / 1000);
          if (atSeconds > 0) {
            void player.seekTo(atSeconds).catch(() => {});
          }
        }
        activeMessageId = messageId;
        if (previous !== undefined && previous !== messageId) {
          playback.resign(resignedSpeaker(previous));
          listeners.get(previous)?.({ playing: false, rate: 1 });
        }
        const rate = currentRate(player);
        player.setPlaybackRate(rate);
        player.play();
        playback.claim(activeSpeaker(messageId, rate));
        listeners.get(messageId)?.({ playing: true, rate });
      };
      if (createPlayer !== undefined) {
        try {
          startWith(createPlayer() as NativePlayer, resumeMs);
        } catch {
          notifyPlayError(messageId, 'Could not play that voice message.');
        }
        return;
      }
      void (async () => {
        try {
          const { createAudioPlayer } = await import('expo-audio');
          startWith(createAudioPlayer(source, { updateInterval: 120 }) as NativePlayer, resumeMs);
        } catch {
          notifyPlayError(messageId, 'Could not play that voice message.');
        }
      })().catch(() => {
        notifyPlayError(messageId, 'Could not play that voice message.');
      });
    },
    pause() {
      const player = sharedPlayer;
      try {
        player?.pause();
      } catch {
        // Pausing a released player is not an error here.
      }
      // Pause keeps the native player alive for a resume (finding 2):
      // only the registry and the active id clear, so playing the same
      // message again seeks on this instance instead of minting one.
      if (activeMessageId !== undefined) {
        const id = activeMessageId;
        activeMessageId = undefined;
        playback.resign(resignedSpeaker(id));
        listeners.get(id)?.({ playing: false, rate: 1 });
      }
    },
    seekTo(positionMs) {
      return sharedPlayer?.seekTo(positionMs / 1000).catch(() => {}) ?? Promise.resolve();
    },
    cycleSpeed() {
      const player = sharedPlayer;
      if (player === undefined || activeMessageId === undefined) {
        return;
      }
      const next =
        VOICE_SPEEDS[(VOICE_SPEEDS.indexOf(currentRate(player)) + 1) % VOICE_SPEEDS.length];
      if (next !== undefined) {
        player.setPlaybackRate(next);
        listeners.get(activeMessageId)?.({ playing: true, rate: next });
      }
    },
  };
  return { playback, controls };
}

function activeSpeaker(messageId: string, rate: VoiceSpeed) {
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
    seekTo: () => Promise.resolve(),
    cycleSpeed: () => {},
    release: () => {},
  };
}

function resignedSpeaker(messageId: string) {
  return {
    messageId,
    playing: false,
    positionMs: 0,
    durationMs: 0,
    speed: 1 as VoiceSpeed,
    play: () => {},
    pause: () => {},
    seekTo: () => Promise.resolve(),
    cycleSpeed: () => {},
    release: () => {},
  };
}

function playbackFor(player: NativePlayer): VoicePlayback | undefined {
  return playerPlaybacks.get(player);
}

/** Routes one real-player status tick to the owning bubble (and the bar). */
function onPlayerStatus(messageId: string, player: NativePlayer, status: PlayerStatusTick): void {
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
  try {
    sharedPlayer?.remove();
  } catch {
    // Releasing never throws.
  }
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

/** Test seam: a host with an injected player factory (finding 1). */
export function createVoicePlayerHostForTest(createPlayer: () => HostPlayer): VoicePlayerHost {
  return createVoicePlayerHost(createPlayer);
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
