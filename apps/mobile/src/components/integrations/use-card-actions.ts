import { Effect } from 'effect';
import { useCallback, useState } from 'react';

import type { CardSaveOutcome } from './card-save';
import { removeIntegrationCard } from './card-save';
import type { IntegrationsApi, IntegrationsStatus } from '@/lib/integrations-api';
import { useAction } from '@/lib/effect/use-action';

/** The secret field pair a card wires into the save machine. */
export interface CardSecret {
  /** Writes the field's next value: empty on success, the typed value on failure. */
  set: (value: string) => void;
  /** Hides the revealed secret once the save stuck. */
  hide: () => void;
}

export interface CardSaveActions<Draft> {
  busy: boolean;
  saved: boolean;
  error: string;
  /** Shows a validation sentence instead of calling the save. */
  fail: (message: string) => void;
  /** Runs the save with the typed draft. */
  submit: (draft: Draft) => void;
  /** Clears the success line after a Remove did the writing. */
  clearSaved: () => void;
}

/**
 * The one save state machine behind the Email, Voice and Telegram cards: it
 * flips `busy` on, runs the card's save, writes the outcome back into `saved`,
 * `error` and the secret field, and flips `busy` off. The card keeps its own
 * validation sentence and hands it to `fail`. The secret clears whenever the
 * save itself succeeded — even when the status reload fails, the server
 * already stores the new secret.
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
 * The one remove state machine behind the Voice and Telegram cards: it flips
 * `removing` on, removes the card, and closes the dialog only after the status
 * reload proves the remove stuck. A failed Remove keeps the dialog open with
 * the error sentence.
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
