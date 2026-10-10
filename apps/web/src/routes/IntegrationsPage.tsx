import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AsyncResult } from 'effect/reactivity';
import { EmailCard } from '@/components/settings/EmailCard';
import { TelegramCard } from '@/components/settings/TelegramCard';
import { VoiceTranscriptionCard } from '@/components/settings/VoiceTranscriptionCard';
import { friendlyError, type PageStatus } from '@/components/settings/integrationErrors';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { getIntegrationsStatus, type IntegrationsStatus } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { failureOf, isWaiting } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';

/**
 * Settings → Integrations (T-0162 + Email follow-up + T-0170 voice
 * transcription). The server owner's key shelf: an Email card (sign-in
 * sender + Resend key), a Telegram card (bot token for sticker import) and
 * a Voice transcription card (OpenAI-compatible endpoint for on-demand
 * voice transcripts). The page is a generic list of
 * integration cards so a GIF provider key can join later (not built now).
 *
 * The page itself is owner-only: `GET /api/settings/integrations` answers
 * the same 404 as an unknown route for anyone else, so a non-owner (or a
 * failed load) sees the owner note instead of the cards. The token and
 * the key are never shown, not even masked.
 */
export function IntegrationsPage() {
  const navigate = useNavigate();
  const [loaded, refresh] = useQuery(() => fromApi(() => getIntegrationsStatus()), []);
  // A card that saves or removes puts its reloaded part here, so the page shows it at once.
  const [patched, setPatched] = useState<Partial<IntegrationsStatus>>({});
  const data = AsyncResult.isSuccess(loaded) ? { ...loaded.value, ...patched } : undefined;

  // A failed load shows the owner note; while a retry runs, the page is loading again.
  const failed = AsyncResult.isFailure(loaded) && !isWaiting(loaded);
  const failure = failed ? failureOf(loaded) : undefined;
  const status: PageStatus = failed ? 'forbidden' : data === undefined ? 'loading' : 'ready';
  // 404 (not the owner) and unknown load failures get the note alone; a server answer gets its message and Retry.
  const errorMessage =
    failure !== undefined && failure.code !== 'unknown_error' && failure.status !== 404
      ? friendlyError(failure)
      : '';

  return (
    <SettingsShell
      title="Integrations"
      subtitle="Keys and senders for the services this server talks to."
      onBack={() => navigate('/')}
    >
      <div className={SETTINGS_COLUMN}>
        {status === 'loading' && <StateMessage kind="loading" title="Loading integrations…" />}

        {status === 'forbidden' && (
          <div className="flex flex-col gap-3">
            <p className="text-[14px] text-muted-foreground">
              Only the person who runs this server can change integrations.
            </p>
            {errorMessage !== '' && (
              <p role="alert" className="text-[14px] text-danger">
                {errorMessage}
              </p>
            )}
            {errorMessage !== '' && (
              <div>
                <Button type="button" size="lg" onClick={() => refresh()}>
                  Retry
                </Button>
              </div>
            )}
          </div>
        )}

        {status === 'ready' && data !== undefined && (
          <div className="flex flex-col gap-4">
            <EmailCard
              email={data.email}
              onSaved={(next) => setPatched((current) => ({ ...current, email: next }))}
            />
            <TelegramCard
              telegram={data.telegram}
              onSaved={(next) => setPatched((current) => ({ ...current, telegram: next }))}
            />
            <VoiceTranscriptionCard
              voiceTranscription={
                data.voiceTranscription ?? { configured: false, baseUrl: null, model: null }
              }
              onSaved={(next) =>
                setPatched((current) => ({ ...current, voiceTranscription: next }))
              }
            />
          </div>
        )}
      </div>
    </SettingsShell>
  );
}
