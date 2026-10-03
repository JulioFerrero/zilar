import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  resetVoiceTranscriptionCache,
  useVoiceTranscriptionEnabled,
} from './useVoiceTranscription';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function Probe() {
  const enabled = useVoiceTranscriptionEnabled();
  return <p>{enabled ? 'enabled' : 'disabled'}</p>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetVoiceTranscriptionCache();
});

describe('useVoiceTranscriptionEnabled', () => {
  it('starts as disabled and switches on after the 200, with one request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { enabled: true }));
    resetVoiceTranscriptionCache();
    vi.stubGlobal('fetch', fetchMock);
    render(<Probe />);

    // The first paint hides the control (never an optimistic flash)…
    expect(screen.getByText('disabled')).toBeTruthy();
    // …then the 200 flips it, and a second consumer reuses the cache.
    expect(await screen.findByText('enabled')).toBeTruthy();
    render(<Probe />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/voice/transcription', expect.anything());
  });

  it('reads an error as disabled without ever flashing enabled', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(500, { error: { code: 'x', message: 'x' } }));
    resetVoiceTranscriptionCache();
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<Probe />);
    expect(await screen.findByText('disabled')).toBeTruthy();
    expect(screen.queryByText(/^enabled$/)).toBeNull();
    unmount();
  });
});
