/**
 * The screen-owned voice player host (T-0154, moved unchanged from
 * `voice-player.ts` by the T-1032 size split): a single `expo-audio` player
 * that every voice bubble shares. The chat screen creates it with
 * `useVoicePlayerHost` and hands `controls` to each `VoiceMessage`;
 * unmounting (leaving the chat) stops playback and releases the native player.
 *
 * One player at a time works like this: `play(B)` on the shared player
 * replaces the source (which stops A's audio natively) and notifies only
 * B's listener, so B shows playing; A's bubble is told to show paused
 * through its own listener — the shared player is never paused as a side
 * effect of switching. The registry (`createVoicePlayback`) is the UI-side
 * record of who is current; this host drives it from the real player events.
 *
 * The player is created lazily with `createAudioPlayer` (not the hook) so
 * the host lives outside any one bubble's lifecycle: a bubble unmounting
 * mid-play must not release the player another bubble is using.
 */

import { Effect } from 'effect';
import { useEffect, useState } from 'react';

import {
  activeSpeaker,
  attempt,
  attemptAsync,
  currentRate,
  getActiveMessageId,
  getSharedPlayer,
  injectedStatus,
  listeners,
  livePlaybacks,
  notifyPlayError,
  onPlayerStatus,
  playerPlaybacks,
  releasePlayer,
  resignedSpeaker,
  setActiveMessageId,
  setSharedPlayer,
} from '@/components/chat/voice-player-registry';
import { isApiOriginUrl, mediaUrl } from '@/lib/attachment-common';
import { getSessionToken } from '@/lib/session-token';
import { createVoicePlayback, VOICE_SPEEDS } from '@/lib/voice-native';
import type { VoicePlayback } from '@/lib/voice-native';

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
  /**
   * Keeps the live chat id (T-1185): the voice URL is routed through
   * `GET /api/files?chat=…` per play, and the screen may be reused for
   * another chat.
   */
  setChatId(chatId: string): void;
};

/**
 * Creates the shared registry + controls for one chat; stops playback on
 * unmount. The chat id (T-1185) is pushed in from the screen so the voice URL
 * is proxied for the right chat.
 */
export function useVoicePlayerHost(chatId: string): VoicePlayerHost {
  const [host] = useState<VoicePlayerHost>(() => createVoicePlayerHost());
  useEffect(() => {
    host.setChatId(chatId);
  }, [host, chatId]);
  useEffect(() => {
    return () => {
      host.playback.stopAll();
      Effect.runSync(releasePlayer());
    };
  }, [host]);
  return host;
}

/**
 * A host whose player is injected (tests inject a fake; production lazily
 * creates the real `expo-audio` player). Every bubble of one chat shares
 * one host, so only one voice plays at a time. The chat id is set per play
 * so the voice URL can be routed through `GET /api/files` (T-1185).
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

export type NativePlayer = {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => Promise<void>;
  replace: (source: { uri: string; headers?: Record<string, string> }) => void;
  setPlaybackRate: (rate: number) => void;
  remove: () => void;
  addListener?: ((event: string, listener: (status: PlayerStatusTick) => void) => void) | undefined;
};

function createVoicePlayerHost(createPlayer?: () => HostPlayer): VoicePlayerHost {
  const playback = createVoicePlayback();
  livePlaybacks.add(playback);
  let chatId = '';
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
    // A player without status events still plays; the bubble keeps its
    // optimistic state and the registry still gates one-at-a-time.
    attempt(() =>
      add.call(player, 'playbackStatusUpdate', (status: PlayerStatusTick) =>
        onPlayerStatus(messageId, player, status),
      ),
    );
  };
  const controls: VoicePlayerControls = {
    play(messageId, source, resumeMs?: number) {
      // A trusted `/upload/` file on our API origin is routed through
      // `GET /api/files` (T-1185); the bearer goes only to that origin.
      const target = mediaUrl(chatId, source.uri);
      const needsToken =
        source.headers === undefined && (target !== source.uri || isApiOriginUrl(target));
      const sourceWith = (
        token: string | undefined,
      ): { uri: string; headers?: Record<string, string> } => {
        const headers =
          source.headers ??
          (token === undefined ? undefined : { authorization: `Bearer ${token}` });
        return headers === undefined ? { uri: target } : { uri: target, headers };
      };
      // Resuming the paused message on its own live player: continue from
      // the paused position instead of restarting at zero (finding 2,
      // round 3). Pause keeps the instance alive, so the shared player is
      // still it — distinguished from a racing fresh instance by the
      // playerPlaybacks record below.
      const active = getSharedPlayer();
      if (
        active !== undefined &&
        playerPlaybacks.get(active) === playback &&
        resumeMs !== undefined &&
        resumeMs > 0
      ) {
        const player = active;
        attemptAsync(() => player.seekTo(resumeMs / 1000));
        setActiveMessageId(messageId);
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
        const previous = getActiveMessageId();
        const current = getSharedPlayer();
        if (current !== player) {
          const old = current;
          if (old !== undefined) {
            // Releasing the previous player never breaks the switch.
            attempt(() => old.remove());
            injectedStatus.delete(old);
          }
          setSharedPlayer(player);
          playerPlaybacks.set(player, playback);
          subscribeStatus(player, messageId);
        } else if (previous === messageId) {
          // Same player re-handed for the active message (the injected
          // factory returns one instance): still continue from the paused
          // position (finding 2, round 3).
          const atSeconds = Math.max(0, (atMs ?? 0) / 1000);
          if (atSeconds > 0) {
            attemptAsync(() => player.seekTo(atSeconds));
          }
        }
        setActiveMessageId(messageId);
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
      const reportFailure = Effect.sync(() =>
        notifyPlayError(messageId, 'Could not play that voice message.'),
      );
      if (createPlayer !== undefined) {
        Effect.runSync(
          Effect.try(() => startWith(createPlayer() as NativePlayer, resumeMs)).pipe(
            Effect.catch(() => reportFailure),
          ),
        );
        return;
      }
      Effect.runFork(
        Effect.gen(function* () {
          const token = needsToken
            ? yield* Effect.tryPromise(() => getSessionToken()).pipe(
                Effect.orElseSucceed(() => undefined),
              )
            : undefined;
          const { createAudioPlayer } = yield* Effect.tryPromise(() => import('expo-audio'));
          yield* Effect.try(() =>
            startWith(
              createAudioPlayer(sourceWith(token), { updateInterval: 120 }) as NativePlayer,
              resumeMs,
            ),
          );
        }).pipe(Effect.catch(() => reportFailure)),
      );
    },
    pause() {
      const player = getSharedPlayer();
      // Pausing a released player is not an error here.
      attempt(() => player?.pause());
      // Pause keeps the native player alive for a resume (finding 2):
      // only the registry and the active id clear, so playing the same
      // message again seeks on this instance instead of minting one.
      const active = getActiveMessageId();
      if (active !== undefined) {
        setActiveMessageId(undefined);
        playback.resign(resignedSpeaker(active));
        listeners.get(active)?.({ playing: false, rate: 1 });
      }
    },
    seekTo(positionMs) {
      const player = getSharedPlayer();
      return Effect.runPromise(
        player === undefined
          ? Effect.void
          : Effect.tryPromise(() => player.seekTo(positionMs / 1000)).pipe(Effect.ignore),
      );
    },
    cycleSpeed() {
      const player = getSharedPlayer();
      const active = getActiveMessageId();
      if (player === undefined || active === undefined) {
        return;
      }
      const next =
        VOICE_SPEEDS[(VOICE_SPEEDS.indexOf(currentRate(player)) + 1) % VOICE_SPEEDS.length];
      if (next !== undefined) {
        player.setPlaybackRate(next);
        listeners.get(active)?.({ playing: true, rate: next });
      }
    },
  };
  return {
    playback,
    controls,
    setChatId(value) {
      chatId = value;
    },
  };
}

/** Test seam: a host with an injected player factory (finding 1). */
export function createVoicePlayerHostForTest(createPlayer: () => HostPlayer): VoicePlayerHost {
  return createVoicePlayerHost(createPlayer);
}
