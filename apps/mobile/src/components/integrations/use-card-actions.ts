import { Effect } from 'effect';
import { useCallback, useState } from 'react';

import type { CardSaveOutcome } from './card-save';
import { removeIntegrationCard } from './card-save';
import type { IntegrationsApi, IntegrationsStatus } from '@/lib/integrations-api';
import { useAction } from '@/lib/effect/use-action';

export interface CardSecret {
  set: (value: string) => void;
  hide: () => void;
}

export interface CardSaveActions<Draft> {
  busy: boolean;
  saved: boolean;
  error: string;
  fail: (message: string) => void;
  submit: (draft: Draft) => void;
  clearSaved: () => void;
}

/**
 * The one save state machine behind the Email, Voice and Telegram cards: it
 * flips `busy`, runs the card's save, writes the outcome into `saved`, `error`
 * and the secret field. The secret clears whenever the save itself succeeded —
 * even when the status reload fails, the server already stores the new secret.
 */
export function useCardSave<Draft>({
  request,
  secret,
  onSaved,
}: {
  request: (draft: Draft) => Promise<CardSaveOutcome>;
  secret: CardSecret;
  onSaved: (next: IntegrationsStatus) => void;
}): CardSaveActions<Draft> {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const [, saveCard] = useAction((draft: Draft) =>
    Effect.sync(() => setBusy(true)).pipe(
      Effect.andThen(Effect.promise(() => request(draft))),
      Effect.tap((outcome) =>
        Effect.sync(() => {
          secret.set(outcome.secretAfterSave);
          if (outcome.status !== null) {
            secret.hide();
            onSaved(outcome.status);
          }
          setSaved(outcome.saved);
          setError(outcome.error);
        }),
      ),
      Effect.ensuring(Effect.sync(() => setBusy(false))),
    ),
  );

  const submit = useCallback(
    (draft: Draft) => {
      setError('');
      setSaved(false);
      saveCard(draft);
    },
    [saveCard],
  );

  const fail = useCallback((message: string) => {
    setError(message);
    setSaved(false);
  }, []);

  const clearSaved = useCallback(() => setSaved(false), []);

  return { busy, saved, error, fail, submit, clearSaved };
}

export interface CardRemoveActions {
  confirming: boolean;
  removing: boolean;
  confirmError: string;
  open: () => void;
  cancel: () => void;
  confirm: () => void;
}

/**
 * The one remove state machine behind the Voice and Telegram cards: the dialog
 * closes only after the status reload proves the remove stuck; a failed Remove
 * keeps it open with the error sentence.
 */
export function useCardRemove({
  api,
  kind,
  onRemoved,
}: {
  api: IntegrationsApi;
  kind: 'telegram' | 'voice';
  onRemoved: (next: IntegrationsStatus) => void;
}): CardRemoveActions {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmError, setConfirmError] = useState('');

  const [, removeCard] = useAction(() =>
    Effect.sync(() => setRemoving(true)).pipe(
      Effect.andThen(Effect.promise(() => removeIntegrationCard(api, kind))),
      Effect.tap((outcome) =>
        Effect.sync(() => {
          if (outcome.status !== null) {
            onRemoved(outcome.status);
            setConfirming(false);
          } else {
            setConfirmError(outcome.error);
          }
        }),
      ),
      Effect.ensuring(Effect.sync(() => setRemoving(false))),
    ),
  );

  const open = useCallback(() => {
    setConfirmError('');
    setConfirming(true);
  }, []);

  const cancel = useCallback(() => setConfirming(false), []);

  const confirm = useCallback(() => {
    if (removing) {
      return;
    }
    setConfirmError('');
    removeCard(undefined);
  }, [removing, removeCard]);

  return { confirming, removing, confirmError, open, cancel, confirm };
}
