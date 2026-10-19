/**
 * A single `expo-audio` player shared by every voice bubble. Switching sources
 * stops the old audio natively and notifies only the new bubble; the old one
 * shows paused through its own listener. Created lazily with
 * `createAudioPlayer` so a bubble unmounting mid-play cannot release the player
 * another bubble uses.
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
import { createVoicePlayback, VOICE_SPEEDS } from '@/lib/voice-playback';
import type { VoicePlayback } from '@/lib/voice-playback';

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
  // The live chat id: the voice URL is routed through `GET /api/files?chat=…` per play, and the screen may be reused.
  setChatId(chatId: string): void;
};

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

// Every bubble of one chat shares one host, so only one voice plays at a time. Tests inject a fake player.
export interface HostPlayer {
  play(): void;
  pause(): void;
  seekTo(seconds: number): Promise<void>;
  replace(source: { uri: string; headers?: Record<string, string> }): void;
  setPlaybackRate(rate: number): void;
  remove(): void;
  /** Real-time status ticks (the 120 ms `updateInterval`); tests drive it. */
  addStatusListener?: ((listener: (status: PlayerStatusTick) => void) => void) | undefined;
  __emitStatus?: ((status: PlayerStatusTick) => void) | undefined;
}

export interface PlayerStatusTick {
  playing: boolean;
  didJustFinish: boolean;
  /** Current position in seconds. */
  currentTime: number;
  /** Total duration in seconds, 0 when unknown. */
  duration: number;
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
      // The injected fake drives ticks through `emitPlayerStatusForTest`; a player without status events still plays.
      injectedStatus.set(player, (status: PlayerStatusTick) =>
        onPlayerStatus(messageId, player, status),
      );
      return;
    }
    const add = player.addListener;
    if (add === undefined) {
      return;
    }
    attempt(() =>
      add.call(player, 'playbackStatusUpdate', (status: PlayerStatusTick) =>
        onPlayerStatus(messageId, player, status),
      ),
    );
  };
  const controls: VoicePlayerControls = {
    play(messageId, source, resumeMs?: number) {
      // A trusted `/upload/` file on our API origin goes through `GET /api/files`; the bearer goes only to that origin.
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
      // Resume on the same live player continues from the paused position; a racing fresh instance is told apart by the `playerPlaybacks` record.
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
        // Switching sources stops the previous audio natively and notifies only the new bubble. A new native instance always releases the old one and subscribes its own status: two quick plays racing the async import would otherwise leak the first player.
        const previous = getActiveMessageId();
        const current = getSharedPlayer();
        if (current !== player) {
          const old = current;
          if (old !== undefined) {
            attempt(() => old.remove());
            injectedStatus.delete(old);
          }
          setSharedPlayer(player);
          playerPlaybacks.set(player, playback);
          subscribeStatus(player, messageId);
        } else if (previous === messageId) {
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
      attempt(() => player?.pause());
      // Pause keeps the native player alive, so playing the same message again seeks on this instance.
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
