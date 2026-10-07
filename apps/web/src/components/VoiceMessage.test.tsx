import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { VoiceMeta } from '@zilar/chat-core';
import { resetVoiceTranscriptCache, VoiceMessage } from './VoiceMessage';
import { resetVoiceTranscriptionCache } from '@/lib/useVoiceTranscription';

const voice: VoiceMeta = {
  duration_ms: 12_000,
  mime: 'audio/m4a',
  waveform: [10, 120, 60, 200, 40, 90],
  transcript: { text: 'hello from the transcript', source: 'api' },
  url: 'http://files.zilar.test/voice-a.m4a',
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** The enabled flag answers `enabled`; transcript POSTs answer per URL. */
function stubTranscription(options: { enabled: boolean; text?: string; failPost?: number }) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: unknown, init?: unknown) => {
    const target = url as string;
    calls.push(`${(init as RequestInit | undefined)?.method ?? 'GET'} ${target}`);
    if (target.endsWith('/voice/transcription')) {
      return jsonResponse(200, { enabled: options.enabled });
    }
    if (target.endsWith('/voice/transcript')) {
      if (options.failPost !== undefined) {
        return jsonResponse(options.failPost, {
          error: { code: 'transcription_failed', message: 'The transcription service failed' },
        });
      }
      const body = JSON.parse(String((init as RequestInit | undefined)?.body ?? '{}')) as {
        url: string;
      };
      return jsonResponse(200, { text: options.text ?? `heard at ${body.url}` });
    }
    return jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetVoiceTranscriptionCache();
  resetVoiceTranscriptCache();
});

describe('VoiceMessage', () => {
  it('toggles the transcript', () => {
    stubTranscription({ enabled: true });
    render(<VoiceMessage chatId="c-ana" voice={voice} own={false} />);

    expect(screen.queryByText('hello from the transcript')).toBeNull();

    fireEvent.click(screen.getByLabelText('Show transcript'));
    expect(screen.getByText('hello from the transcript')).toBeTruthy();
    expect(screen.getByLabelText('Hide transcript')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Hide transcript'));
    expect(screen.queryByText('hello from the transcript')).toBeNull();
  });

  it('shows the duration and a play button', () => {
    stubTranscription({ enabled: true });
    render(<VoiceMessage chatId="c-ana" voice={voice} own={false} />);
    expect(screen.getByText('0:12')).toBeTruthy();
    expect(screen.getByLabelText('Play voice message')).toBeTruthy();
  });

  it('shows nothing at all when transcription is not enabled', async () => {
    stubTranscription({ enabled: false });
    const { transcript: _transcript, ...withoutTranscript } = voice;
    render(<VoiceMessage chatId="c-ana" voice={withoutTranscript} own={true} />);
    // The control appears only for the embedded transcript (none here) or
    // while the server says enabled — neither, so no button, ever.
    expect(screen.queryByLabelText('Show transcript')).toBeNull();
    await screen.findByLabelText('Play voice message');
    expect(screen.queryByLabelText('Show transcript')).toBeNull();
  });

  it('fetches the transcript on demand and remembers it for the session', async () => {
    const { calls, fetchMock } = stubTranscription({ enabled: true });
    resetVoiceTranscriptionCache();
    resetVoiceTranscriptCache();
    const { transcript: _transcript, ...withoutTranscript } = voice;
    const { unmount } = render(
      <VoiceMessage chatId="c-ana" voice={withoutTranscript} own={false} />,
    );

    expect(await screen.findByLabelText('Show transcript')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Show transcript'));
    expect(await screen.findByText('heard at http://files.zilar.test/voice-a.m4a')).toBeTruthy();

    // Toggling closed and open again does not refetch…
    fireEvent.click(screen.getByLabelText('Hide transcript'));
    fireEvent.click(screen.getByLabelText('Show transcript'));
    expect(screen.getByText('heard at http://files.zilar.test/voice-a.m4a')).toBeTruthy();

    // …and neither does meeting the same message again after a remount.
    unmount();
    render(<VoiceMessage chatId="c-ana" voice={withoutTranscript} own={false} />);
    fireEvent.click(await screen.findByLabelText('Show transcript'));
    expect(await screen.findByText('heard at http://files.zilar.test/voice-a.m4a')).toBeTruthy();

    const posts = calls.filter((call) => call === 'POST /api/voice/transcript');
    expect(posts).toHaveLength(1);
    const [, postInit] = fetchMock.mock.calls.find(([url]) =>
      (url as string).endsWith('/voice/transcript'),
    ) as [string, RequestInit];
    expect(JSON.parse(postInit.body as string)).toEqual({
      url: 'http://files.zilar.test/voice-a.m4a',
    });
  });

  it('shows a short error with Retry, and Retry fetches again', async () => {
    const { calls } = stubTranscription({ enabled: true, failPost: 502 });
    resetVoiceTranscriptionCache();
    resetVoiceTranscriptCache();
    const { transcript: _transcript, ...withoutTranscript } = voice;
    render(<VoiceMessage chatId="c-ana" voice={withoutTranscript} own={false} />);

    fireEvent.click(await screen.findByLabelText('Show transcript'));
    expect(await screen.findByText(/Transcription failed/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText(/Transcription failed/);
    const posts = calls.filter((call) => call === 'POST /api/voice/transcript');
    expect(posts).toHaveLength(2);
  });

  it('plays a same-origin upload through the file route but transcribes the raw URL', async () => {
    const { fetchMock } = stubTranscription({ enabled: true });
    const url = `${window.location.origin}/upload/ana/voice.m4a`;
    const { transcript: _transcript, ...withoutTranscript } = voice;
    render(<VoiceMessage chatId="c-ana" voice={{ ...withoutTranscript, url }} own={false} />);

    const expected = `/api/files?chat=${encodeURIComponent('c-ana')}&url=${encodeURIComponent(url)}`;
    expect(document.querySelector('audio')?.getAttribute('src')).toBe(expected);

    fireEvent.click(await screen.findByLabelText('Show transcript'));
    expect(await screen.findByText(`heard at ${url}`)).toBeTruthy();

    const [, postInit] = fetchMock.mock.calls.find(([target]) =>
      (target as string).endsWith('/voice/transcript'),
    ) as [string, RequestInit];
    expect(JSON.parse(postInit.body as string)).toEqual({ url });
  });
});
