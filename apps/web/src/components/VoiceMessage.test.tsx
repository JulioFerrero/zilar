import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { VoiceMeta } from '@galena/chat-core';
import { VoiceMessage } from './VoiceMessage';

const voice: VoiceMeta = {
  duration_ms: 12_000,
  mime: 'audio/m4a',
  waveform: [10, 120, 60, 200, 40, 90],
  transcript: { text: 'hello from the transcript', source: 'api' },
};

describe('VoiceMessage', () => {
  it('toggles the transcript', () => {
    render(<VoiceMessage voice={voice} own={false} />);

    expect(screen.queryByText('hello from the transcript')).toBeNull();

    fireEvent.click(screen.getByLabelText('Show transcript'));
    expect(screen.getByText('hello from the transcript')).toBeTruthy();
    expect(screen.getByLabelText('Hide transcript')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Hide transcript'));
    expect(screen.queryByText('hello from the transcript')).toBeNull();
  });

  it('shows the duration and a play button', () => {
    render(<VoiceMessage voice={voice} own={false} />);
    expect(screen.getByText('0:12')).toBeTruthy();
    expect(screen.getByLabelText('Play voice message')).toBeTruthy();
  });

  it('has no transcript button without a transcript', () => {
    const { transcript: _transcript, ...withoutTranscript } = voice;
    render(<VoiceMessage voice={withoutTranscript} own={true} />);
    expect(screen.queryByLabelText('Show transcript')).toBeNull();
  });
});
