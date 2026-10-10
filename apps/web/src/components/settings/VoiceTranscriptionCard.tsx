import { useState } from 'react';
import { AsyncResult } from 'effect/reactivity';
import { Button } from '@/components/ui/button';
import { SecretInput, TextInput } from '@/components/ui/text-input';
import {
  removeVoiceTranscriptionSettings,
  saveVoiceTranscriptionSettings,
  type IntegrationsStatus,
} from '@/lib/api';
import { isWaiting } from '@/lib/effect/use-action';
import { EndpointMissing, friendlyError, shownFailure } from './integrationErrors';
import { useIntegrationSave } from './useIntegrationSave';

type VoiceOp =
  | {
      readonly kind: 'save';
      readonly baseUrl: string;
      readonly key: string;
      readonly model: string;
    }
  | { readonly kind: 'remove' };

export function VoiceTranscriptionCard({
  voiceTranscription,
  onSaved,
}: {
  voiceTranscription: NonNullable<IntegrationsStatus['voiceTranscription']>;
  onSaved: (next: NonNullable<IntegrationsStatus['voiceTranscription']>) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(voiceTranscription.baseUrl ?? '');
  const [key, setKey] = useState('');
  const [model, setModel] = useState(voiceTranscription.model ?? 'whisper-1');
  const [state, runVoice] = useIntegrationSave<VoiceOp, 'saved' | 'removed', EndpointMissing>({
    write: (op) => {
      if (op.kind === 'remove') {
        return removeVoiceTranscriptionSettings();
      }
      const trimmedBaseUrl = op.baseUrl.trim();
      const trimmedKey = op.key.trim();
      const trimmedModel = op.model.trim();
      return saveVoiceTranscriptionSettings({
        baseUrl: trimmedBaseUrl,
        ...(trimmedKey === '' ? {} : { apiKey: trimmedKey }),
        model: trimmedModel === '' ? 'whisper-1' : trimmedModel,
      });
    },
    validate: (op) =>
      op.kind === 'save' && op.baseUrl.trim() === '' ? new EndpointMissing() : undefined,
    clearInput: (op) => {
      if (op.kind === 'save') {
        setKey('');
      }
    },
    onSaved: (next, op) => {
      if (op.kind === 'save') {
        const trimmedBaseUrl = op.baseUrl.trim();
        const trimmedModel = op.model.trim();
        onSaved(
          next.voiceTranscription ?? {
            configured: true,
            baseUrl: trimmedBaseUrl,
            model: trimmedModel,
          },
        );
        return;
      }
      onSaved(next.voiceTranscription ?? { configured: false, baseUrl: null, model: null });
    },
    value: (op) => (op.kind === 'save' ? 'saved' : 'removed'),
  });

  const busy = isWaiting(state);
  const saved = !busy && AsyncResult.isSuccess(state) && state.value === 'saved';
  const failure = shownFailure(state);
  const errorMessage =
    failure === undefined
      ? ''
      : failure._tag === 'EndpointMissing'
        ? 'Enter the endpoint base URL first.'
        : friendlyError(failure);

  return (
    <section
      aria-label="Voice transcription"
      className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold">Voice transcription</h2>
        <span className="rounded-full bg-surface-raised px-2 py-0.5 text-[12px] text-muted-foreground">
          {voiceTranscription.configured ? 'Connected' : 'Not set up'}
        </span>
      </div>
      <p className="text-[14px] text-muted-foreground">
        Adds a “Show transcript” control under voice messages
        {voiceTranscription.model ? ` — currently ${voiceTranscription.model}` : ''}. Transcription
        is off until an endpoint is saved. Audio goes only to the endpoint below, never anywhere
        else.
      </p>
      <p className="text-[13px] text-muted-foreground">
        Any OpenAI-compatible <code>/audio/transcriptions</code> endpoint works: OpenAI (
        <code>https://api.openai.com/v1</code>), Groq (<code>https://api.groq.com/openai/v1</code>),
        or a self-hosted Whisper server (plain http is allowed only for localhost or a private
        address).
      </p>
      <label className="flex flex-col gap-1 text-[14px]">
        Base URL
        <TextInput
          value={baseUrl}
          aria-label="Base URL"
          placeholder="https://api.openai.com/v1"
          maxLength={512}
          disabled={busy}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-[14px]">
        Model
        <TextInput
          value={model}
          aria-label="Model"
          placeholder="whisper-1"
          maxLength={128}
          disabled={busy}
          onChange={(event) => setModel(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-[14px]">
        API key
        <SecretInput
          value={key}
          aria-label="API key"
          placeholder="sk-…"
          maxLength={512}
          autoComplete="off"
          disabled={busy}
          onChange={(event) => setKey(event.target.value)}
        />
      </label>
      <p className="text-[13px] text-muted-foreground">
        Optional — leave empty for a self-hosted server without one. The key is never shown again
        after saving.
      </p>
      {errorMessage !== '' && (
        <p role="alert" className="text-[14px] text-danger">
          {errorMessage}
        </p>
      )}
      {saved && <p className="text-[14px] text-online">Saved — transcripts are on.</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="default"
          onClick={() => runVoice({ kind: 'save', baseUrl, key, model })}
          disabled={busy}
        >
          {busy ? 'Checking…' : 'Save'}
        </Button>
        {voiceTranscription.configured && (
          <Button
            type="button"
            variant="outline"
            onClick={() => runVoice({ kind: 'remove' })}
            disabled={busy}
          >
            Remove
          </Button>
        )}
      </div>
    </section>
  );
}
