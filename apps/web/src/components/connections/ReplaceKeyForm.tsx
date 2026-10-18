import { useState } from 'react';
import { Data, Effect } from 'effect';
import { Button } from '@/components/ui/button';
import { SecretInput } from '@/components/ui/text-input';
import { replaceConnectionKey } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { isWaiting, shownFailure, useAction } from '@/lib/effect/use-action';

/** The form's own check: the key is pasted before anything is sent. */
class KeyMissing extends Data.TaggedError('KeyMissing') {}

type FormError = KeyMissing | ApiFailure;

/** The server's words for a failure, or the fixed fallback for a call that never reached the server. */
function messageOf(failure: ApiFailure, fallback: string): string {
  return failure.code === 'unknown_error' ? fallback : failure.message;
}

/**
 * The inline "Replace key" form for one connection: a password-type input and
 * Save. The server keeps the connection and only swaps the key, so the AIs
 * using it keep working. Success is reported by the row; a failure shows here.
 */
export function ReplaceKeyForm({
  connectionId,
  onCancel,
  onSaved,
}: {
  connectionId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [key, setKey] = useState('');
  const [state, save] = useAction((draftKey: string): Effect.Effect<void, FormError> => {
    const trimmedKey = draftKey.trim();
    if (trimmedKey === '') {
      return Effect.fail(new KeyMissing());
    }
    return fromApi(() => replaceConnectionKey(connectionId, trimmedKey)).pipe(
      Effect.asVoid,
      Effect.tap(() => Effect.sync(onSaved)),
    );
  });

  const busy = isWaiting(state);
  const failure = shownFailure(state);
  const error =
    failure === undefined
      ? ''
      : failure._tag === 'KeyMissing'
        ? 'Paste your API key'
        : messageOf(failure, 'Could not replace the key');

  return (
    <div className="mt-2 flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-[14px] font-medium">New API key</span>
        <SecretInput
          value={key}
          placeholder="sk-…"
          maxLength={16384}
          autoComplete="off"
          onChange={(event) => setKey(event.target.value)}
        />
      </label>

      {error !== '' && (
        <p role="alert" className="text-[14px] text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="button" size="default" disabled={busy} onClick={() => save(key)}>
          Save key
        </Button>
        <Button type="button" variant="ghost" size="default" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
