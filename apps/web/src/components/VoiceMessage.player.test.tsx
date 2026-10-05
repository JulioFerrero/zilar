import { fireEvent, render, screen } from '@testing-library/react';
import type { VoiceMeta } from '@zilar/chat-core';
import { describe, expect, it, vi } from 'vitest';
import { VoiceMessage } from './VoiceMessage';

const voice: VoiceMeta = {
  duration_ms: 12_000,
  mime: 'audio/m4a',
  waveform: [10, 120, 60, 200, 40, 90],
  transcript: { text: 'hello from the transcript', source: 'api' },
  url: 'http://files.zilar.test/voice.m4a',
};

function playableAudio(): HTMLAudioElement {
  const player = document.querySelector('audio');
  if (player === null) {
    throw new Error('no audio element found');
  }
  return player;
}

function stubPlay(audio: HTMLAudioElement): void {
  // jsdom has no playback: the stub fires the event the browser would, and
  // the component learns its state from that event.
  vi.spyOn(audio, 'play').mockImplementation(() => {
    fireEvent.play(audio);
    return Promise.resolve();
  });
}

describe('VoiceMessage player (T-0166)', () => {
  it('uses theme tokens for the waveform, never hardcoded hex', () => {
    const { container } = render(<VoiceMessage voice={voice} own={true} />);
    const bars = container.querySelectorAll('span[aria-hidden="true"] > span');
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      expect(bar.className).toMatch(/bg-voice-(played|unplayed)/);
      expect(bar.className).not.toContain('#');
    }
  });

  it('returns to Play and resets progress when the track ends', () => {
    render(<VoiceMessage voice={voice} own={false} />);
    const audio = playableAudio();
    stubPlay(audio);

    fireEvent.click(screen.getByLabelText('Play voice message'));
    expect(screen.getByLabelText('Pause voice message')).toBeTruthy();

    fireEvent.ended(audio);
    expect(screen.getByLabelText('Play voice message')).toBeTruthy();
  });

  it('follows pauses that come from outside the button', () => {
    render(<VoiceMessage voice={voice} own={false} />);
    const audio = playableAudio();
    stubPlay(audio);

    fireEvent.click(screen.getByLabelText('Play voice message'));
    expect(screen.getByLabelText('Pause voice message')).toBeTruthy();

    fireEvent.pause(audio);
    expect(screen.getByLabelText('Play voice message')).toBeTruthy();
  });

  it('pauses the first message when a second one starts', () => {
    render(
      <>
        <VoiceMessage voice={voice} own={false} />
        <VoiceMessage voice={{ ...voice, url: 'http://files.zilar.test/other.m4a' }} own={true} />
      </>,
    );
    const audios = document.querySelectorAll('audio');
    const [first, second] = [audios[0], audios[1]];
    if (first === undefined || second === undefined) {
      throw new Error('expected two players');
    }
    // jsdom has no playback: pausing fires the event the browser would, so
    // the first player's button follows. The first player's `play` only
    // needs to set the shared active element, like the real handler.
    const pauseFirst = vi.spyOn(first, 'pause').mockImplementation(() => fireEvent.pause(first));
    vi.spyOn(first, 'play').mockImplementation(() => {
      fireEvent.play(first);
      return Promise.resolve();
    });
    stubPlay(second);

    const buttons = screen.getAllByLabelText('Play voice message');
    fireEvent.click(buttons[0] as HTMLElement);
    fireEvent.click(buttons[1] as HTMLElement);

    expect(pauseFirst).toHaveBeenCalled();
  });

  it('shows the unavailable state when the audio errors', () => {
    render(<VoiceMessage voice={voice} own={false} />);
    fireEvent.error(playableAudio());

    const button = screen.getByLabelText('Play voice message');
    expect(button.getAttribute('title')).toBe('Audio unavailable');
    expect(button.className).toContain('opacity-50');
  });

  it('retries playback when the button is clicked after an error', () => {
    render(<VoiceMessage voice={voice} own={false} />);
    const audio = playableAudio();
    fireEvent.error(audio);
    expect(screen.getByLabelText('Play voice message').getAttribute('title')).toBe(
      'Audio unavailable',
    );
    stubPlay(audio);

    fireEvent.click(screen.getByLabelText('Play voice message'));

    expect(screen.getByLabelText('Pause voice message')).toBeTruthy();
    expect(screen.getByLabelText('Pause voice message').getAttribute('title')).toBeNull();
  });

  it('shows the unavailable state without a url instead of doing nothing', () => {
    const { url: _url, ...withoutUrl } = voice;
    render(<VoiceMessage voice={withoutUrl} own={false} />);

    const button = screen.getByLabelText('Play voice message');
    expect(button.getAttribute('title')).toBe('Audio unavailable');
  });
});
