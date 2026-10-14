import { useState } from 'react';
import { Data, Effect } from 'effect';
import { AI_PROVIDERS, type AiProvider } from '@zilar/chat-core';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { SecretInput, TextInput } from '@/components/ui/text-input';
import { createConnection, type Connection } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';

export { providerLabel } from '@zilar/chat-core';

/** The form's own check: the key is pasted before anything is sent. */
class KeyMissing extends Data.TaggedError('KeyMissing') {}

/** T-1396: the custom provider needs a base URL and a label before saving. */
class BaseUrlMissing extends Data.TaggedError('BaseUrlMissing') {}

class LabelMissing extends Data.TaggedError('LabelMissing') {}

type FormError = KeyMissing | BaseUrlMissing | LabelMissing | ApiFailure;

/** The server's words for a failure, or the fixed fallback for a call that never reached the server. */
function messageOf(failure: ApiFailure, fallback: string): string {
  return failure.code === 'unknown_error' ? fallback : failure.message;
}

/**
 * The add form: a provider, a secure key field and an optional label. The key
 * lives in this component's state only and travels only in the POST body; it is
 * never logged or rendered back. `onSaved` hands back the saved connection so
 * the caller can select it.
 */
export function AddConnectionForm({
  onCancel,
  onSaved,
  providers = AI_PROVIDERS,
}: {
  onCancel: () => void;
  onSaved: (connection: Connection) => void;
  /**
   * Which providers to offer. Defaults to every provider; the AI wizard passes
   * the LLM ones only, because a GitHub key cannot run an AI.
   */
  providers?: readonly AiProvider[];
}) {
  const [provider, setProvider] = useState<string>(providers[0]?.id ?? 'openai');
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [label, setLabel] = useState('');
  // T-1396: the custom provider is the only one with a base URL and the only
  // one whose label is required.
  const isCustom = provider === 'openai-compatible';
  const [state, save] = useAction(
    (draft: {
      readonly provider: string;
      readonly key: string;
      readonly baseUrl: string;
      readonly label: string;
    }): Effect.Effect<Connection, FormError> => {
      const trimmedKey = draft.key.trim();
      if (trimmedKey === '') {
        return Effect.fail(new KeyMissing());
      }
      const custom = draft.provider === 'openai-compatible';
      const trimmedLabel = draft.label.trim();
      const trimmedBaseUrl = draft.baseUrl.trim();
      if (custom && trimmedBaseUrl === '') {
        return Effect.fail(new BaseUrlMissing());
      }
      if (custom && trimmedLabel === '') {
        return Effect.fail(new LabelMissing());
      }
      return fromApi(() =>
        createConnection({
          provider: draft.provider,
          key: trimmedKey,
          ...(trimmedLabel === '' ? {} : { label: trimmedLabel }),
          ...(custom ? { baseUrl: trimmedBaseUrl } : {}),
        }),
      ).pipe(Effect.tap((connection) => Effect.sync(() => onSaved(connection))));
    },
  );

  const busy = isWaiting(state);
  const failure = busy ? undefined : failureOf(state);
  const error =
    failure === undefined
      ? ''
      : failure._tag === 'KeyMissing'
        ? 'Paste your API key'
        : failure._tag === 'BaseUrlMissing'
          ? 'Enter a base URL'
          : failure._tag === 'LabelMissing'
            ? 'Enter a label'
            : messageOf(failure, 'Could not save the connection');

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">New connection</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          title="Close"
          onClick={onCancel}
          className="rounded-full text-muted-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[14px] font-medium">Provider</span>
          <Select
            label="Provider"
            options={providers.map((option) => ({ value: option.id, label: option.label }))}
            value={provider}
            onValueChange={setProvider}
          />
        </div>

        {isCustom && (
          <label className="flex flex-col gap-1">
            <span className="text-[14px] font-medium">Base URL</span>
            <TextInput
              value={baseUrl}
              placeholder="https://api.groq.com/openai/v1"
              maxLength={300}
              autoComplete="off"
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[14px] font-medium">API key</span>
          <SecretInput
            value={key}
            placeholder="sk-…"
            maxLength={16384}
            autoComplete="off"
            onChange={(event) => setKey(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[14px] font-medium">{isCustom ? 'Label' : 'Label (optional)'}</span>
          <TextInput
            value={label}
            placeholder="Work project"
            maxLength={256}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>

        {error !== '' && (
          <p role="alert" className="text-[14px] text-danger">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="lg"
            disabled={busy}
            onClick={() => save({ provider, key, baseUrl, label })}
          >
            Save
          </Button>
          <Button type="button" variant="ghost" size="lg" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
