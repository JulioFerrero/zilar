/**
 * The screen-owned voice player (T-0154): a single `expo-audio` player that
 * every voice bubble shares through the one-at-a-time registry. The chat
 * screen creates it with `useVoicePlayerHost` and hands `controls` to each
 * `VoiceMessage`; unmounting (leaving the chat) stops playback and releases
 * the native player.
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
  play(messageId: string, source: { uri: string; headers?: Record<string, string> }): void;
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

type NativePlayer = {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => Promise<void>;
  replace: (source: { uri: string; headers?: Record<string, string> }) => void;
  setPlaybackRate: (rate: number) => void;
  remove: () => void;
};

let sharedPlayer: NativePlayer | undefined;
let activeMessageId: string | undefined;
const listeners = new Map<string, (update: { playing: boolean; rate: VoiceSpeed }) => void>();

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

function createVoicePlayerHost(): VoicePlayerHost {
  const playback = createVoicePlayback();
  const controls: VoicePlayerControls = {
    play(messageId, source) {
      void (async () => {
        const { createAudioPlayer } = await import('expo-audio');
        if (sharedPlayer === undefined) {
          sharedPlayer = createAudioPlayer(source, { updateInterval: 120 }) as NativePlayer;
        } else if (activeMessageId !== messageId) {
          sharedPlayer.replace(source);
        }
        const player = sharedPlayer;
        activeMessageId = messageId;
        const rate = currentRate(player);
        player.setPlaybackRate(rate);
        player.play();
        listeners.get(messageId)?.({ playing: true, rate });
      })().catch(() => {});
    },
    pause() {
      try {
        sharedPlayer?.pause();
      } catch {
        // Pausing a released player is not an error here.
      }
      if (activeMessageId !== undefined) {
        listeners.get(activeMessageId)?.({ playing: false, rate: 1 });
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
  void playback;
  return { playback, controls };
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
