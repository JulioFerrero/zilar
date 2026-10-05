import { useEffect, useState } from 'react';
import { getVoiceTranscriptionStatus } from '@/lib/api';

/**
 * Whether voice transcription is enabled on this server (T-0170).
 * `GET /api/voice/transcription` answers `{ enabled }` for any signed-in
 * user; the answer is fetched once per session and cached in module state,
 * so every voice message shares one request — like `useIsServerOwner`.
 * Starts as disabled and only switches on after the server says so.
 */
let cached: boolean | undefined;

export function useVoiceTranscriptionEnabled(): boolean {
  const [enabled, setEnabled] = useState(cached ?? false);

  // The effect only synchronizes with the status endpoint (the lint rule
  // flags synchronous setState inside effects); the fetch promise resolves
  // the next state, applied once.
  useEffect(() => {
    if (cached !== undefined) {
      return;
    }
    let active = true;
    void enabledFromServer().then((next) => {
      cached = next;
      if (active) {
        setEnabled(next);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return enabled;
}

async function enabledFromServer(): Promise<boolean> {
  try {
    const { enabled } = await getVoiceTranscriptionStatus();
    return enabled;
  } catch {
    // Any failure reads as disabled: the control simply stays hidden.
    return false;
  }
}

/** Forgets the cached answer (tests only). */
export function resetVoiceTranscriptionCache(): void {
  cached = undefined;
}
