import { beforeEach, describe, expect, it } from 'vitest';

import {
  createVoicePlayerHostForTest,
  emitPlayerStatusForTest,
  resetVoicePlayerForTest,
  subscribeVoicePlayError,
  subscribeVoiceProgress,
  subscribeVoiceState,
  type HostPlayer,
} from './voice-player';

/**
 * The one-player-at-a-time rule against a fake shared player (finding 1).
 * With the old behaviour (the claimed speaker pausing the shared controls),
 * playing B would stop B again; here B plays, A shows paused, pausing B
 * pauses the player, and finishing B resets it.
 */
function fakePlayer(): HostPlayer & { calls: string[]; replaced: number; rates: number[] } {
  const calls: string[] = [];
  let replaced = 0;
  const rates: number[] = [];
  const player: HostPlayer & { calls: string[]; replaced: number; rates: number[] } = {
    calls,
    get replaced() {
      return replaced;
    },
    rates,
    play: () => {
      calls.push('play');
    },
    pause: () => {
      calls.push('pause');
    },
    seekTo: async () => {},
    replace: () => {
      replaced += 1;
      calls.push('replace');
    },
    setPlaybackRate: (rate: number) => {
      rates.push(rate);
    },
    remove: () => {
      calls.push('remove');
    },
  };
  return player;
}

describe('voice player host one-at-a-time (T-0154 review)', () => {
  beforeEach(() => {
    resetVoicePlayerForTest();
  });

  it('play A, play B: B plays with the player playing, A not playing', () => {
    const playerA = fakePlayer();
    const playerB = fakePlayer();
    let calls = 0;
    const host = createVoicePlayerHostForTest(() => {
      calls += 1;
      return calls === 1 ? playerA : playerB;
    });
    const states = new Map<string, { playing: boolean; rate: number }>();
    const stopA = subscribeVoiceState('m-a', (update) => states.set('m-a', update));
    const stopB = subscribeVoiceState('m-b', (update) => states.set('m-b', update));

    host.controls.play('m-a', { uri: 'file:///a.m4a' });
    expect(states.get('m-a')).toEqual({ playing: true, rate: 1 });
    expect(playerA.calls).toContain('play');
    expect(host.playback.current()?.messageId).toBe('m-a');

    host.controls.play('m-b', { uri: 'file:///b.m4a' });
    // B shows playing with the player playing; A shows paused. The old
    // behaviour paused the shared player on the switch, silencing B.
    expect(states.get('m-b')).toEqual({ playing: true, rate: 1 });
    expect(states.get('m-a')).toEqual({ playing: false, rate: 1 });
    expect(playerB.calls).toContain('play');
    expect(playerA.calls).toContain('remove');
    expect(playerA.calls).not.toContain('pause');
    expect(playerB.calls).not.toContain('pause');
    expect(host.playback.current()?.messageId).toBe('m-b');

    stopA();
    stopB();
  });

  it('two quick plays of the same message keep exactly one live player', () => {
    const first = fakePlayer();
    const second = fakePlayer();
    let calls = 0;
    const host = createVoicePlayerHostForTest(() => {
      calls += 1;
      return calls === 1 ? first : second;
    });
    const states = new Map<string, { playing: boolean; rate: number }>();
    const progress: Array<{ positionMs: number; durationMs: number }> = [];
    const stopState = subscribeVoiceState('m-a', (update) => states.set('m-a', update));
    const stopProgress = subscribeVoiceProgress('m-a', (update) => progress.push(update));

    // Two taps racing the async import: each built its own native player.
    host.controls.play('m-a', { uri: 'file:///a.m4a' });
    host.controls.play('m-a', { uri: 'file:///a.m4a' });

    // Exactly one live player: the old one is released, and the bubble's
    // status ticks arrive (the old code skipped both for the same id).
    expect(first.calls).toContain('remove');
    expect(second.calls).toContain('play');
    expect(states.get('m-a')).toEqual({ playing: true, rate: 1 });
    emitPlayerStatusForTest(second, {
      playing: true,
      didJustFinish: false,
      currentTime: 1,
      duration: 12,
      error: null,
    });
    expect(progress.at(-1)).toEqual({ positionMs: 1000, durationMs: 12000 });

    stopState();
    stopProgress();
  });

  it('pause B pauses the player and clears the registry', () => {
    const playerA = fakePlayer();
    const playerB = fakePlayer();
    let calls = 0;
    const host = createVoicePlayerHostForTest(() => {
      calls += 1;
      return calls === 1 ? playerA : playerB;
    });
    host.controls.play('m-a', { uri: 'file:///a.m4a' });
    host.controls.play('m-b', { uri: 'file:///b.m4a' });
    host.controls.pause();
    expect(playerB.calls).toContain('pause');
    expect(host.playback.current()).toBeUndefined();
  });

  it('a failing player surfaces a visible play error on the asking bubble', () => {
    const host = createVoicePlayerHostForTest(() => {
      throw new Error('no audio');
    });
    const errors: string[] = [];
    const stop = subscribeVoicePlayError('m-a', (copy) => errors.push(copy));
    host.controls.play('m-a', { uri: 'file:///a.m4a' });
    expect(errors).toEqual(['Could not play that voice message.']);
    stop();
  });

  it('a status tick drives progress and a finish resets the bubble', () => {
    const player = fakePlayer();
    const states = new Map<string, { playing: boolean; rate: number }>();
    const progress: Array<{ positionMs: number; durationMs: number }> = [];
    const stopState = subscribeVoiceState('m-a', (update) => states.set('m-a', update));
    const stopProgress = subscribeVoiceProgress('m-a', (update) => progress.push(update));
    const host = createVoicePlayerHostForTest(() => player);
    host.controls.play('m-a', { uri: 'file:///a.m4a' });
    emitPlayerStatusForTest(player, {
      playing: true,
      didJustFinish: false,
      currentTime: 2.5,
      duration: 12,
      error: null,
    });
    expect(progress.at(-1)).toEqual({ positionMs: 2500, durationMs: 12000 });
    emitPlayerStatusForTest(player, {
      playing: false,
      didJustFinish: true,
      currentTime: 12,
      duration: 12,
      error: null,
    });
    expect(states.get('m-a')).toEqual({ playing: false, rate: 1 });
    expect(progress.at(-1)).toEqual({ positionMs: 0, durationMs: 12000 });
    expect(host.playback.current()).toBeUndefined();
    stopState();
    stopProgress();
  });
});
